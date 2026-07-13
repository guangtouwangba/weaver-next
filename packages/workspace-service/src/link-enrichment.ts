import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const HTML_LIMIT = 2 * 1024 * 1024;
const IMAGE_LIMIT = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
type ImageMimeType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

type LookupResult = { address: string; family: number };
export type EnrichmentDependencies = {
  fetchImpl?: typeof fetch;
  lookupImpl?: (hostname: string) => Promise<LookupResult[]>;
};

function privateAddress(address: string) {
  if (address === "::1" || address === "::" || address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe80:")) return true;
  if (address.startsWith("::ffff:")) return privateAddress(address.slice(7));
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

async function assertPublicUrl(rawUrl: string, lookupImpl: NonNullable<EnrichmentDependencies["lookupImpl"]>) {
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("LINK_PROTOCOL_BLOCKED:Use a public HTTP or HTTPS URL");
  if (url.username || url.password) throw new Error("LINK_CREDENTIALS_BLOCKED:URLs with credentials are not allowed");
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) throw new Error("LINK_PRIVATE_HOST_BLOCKED");
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookupImpl(hostname);
  if (!addresses.length || addresses.some((entry) => privateAddress(entry.address))) throw new Error("LINK_PRIVATE_HOST_BLOCKED");
  return url;
}

async function readLimited(response: Response, limit: number) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > limit) throw new Error("LINK_RESPONSE_TOO_LARGE");
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new Error("LINK_RESPONSE_TOO_LARGE"); }
    chunks.push(value);
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

async function safeFetch(rawUrl: string, limit: number, dependencies: Required<EnrichmentDependencies>) {
  let url = await assertPublicUrl(rawUrl, dependencies.lookupImpl);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await dependencies.fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(5000), headers: { "user-agent": "Weaver-Link-Preview/1.0", accept: "text/html,image/*;q=0.8" } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirects === 3) throw new Error("LINK_REDIRECT_LIMIT");
      const location = response.headers.get("location");
      if (!location) throw new Error("LINK_REDIRECT_WITHOUT_LOCATION");
      url = await assertPublicUrl(new URL(location, url).href, dependencies.lookupImpl);
      continue;
    }
    if (!response.ok) throw new Error(`LINK_FETCH_FAILED:HTTP ${response.status}`);
    return { response, data: await readLimited(response, limit), finalUrl: url };
  }
  throw new Error("LINK_REDIRECT_LIMIT");
}

function decode(value: string) {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}

function meta(html: string, keys: string[]) {
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i"),
    ];
    for (const pattern of patterns) { const match = html.match(pattern); if (match) return decode(match[1]); }
  }
  return "";
}

export async function enrichPublicLink(rawUrl: string, dependencies: EnrichmentDependencies = {}) {
  const deps: Required<EnrichmentDependencies> = {
    fetchImpl: dependencies.fetchImpl ?? fetch,
    lookupImpl: dependencies.lookupImpl ?? (async (hostname) => lookup(hostname, { all: true })),
  };
  const page = await safeFetch(rawUrl, HTML_LIMIT, deps);
  const contentType = page.response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "text/html" && contentType !== "application/xhtml+xml") throw new Error("LINK_CONTENT_TYPE_UNSUPPORTED:Expected an HTML page");
  const html = new TextDecoder().decode(page.data);
  const title = meta(html, ["og:title", "twitter:title"]) || decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const description = meta(html, ["og:description", "twitter:description", "description"]).slice(0, 500);
  const imageUrl = meta(html, ["og:image:secure_url", "og:image", "twitter:image"]);
  let image: { data: Uint8Array; mimeType: ImageMimeType } | undefined;
  if (imageUrl) {
    try {
      const cover = await safeFetch(new URL(imageUrl, page.finalUrl).href, IMAGE_LIMIT, deps);
      const mimeType = cover.response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
      if (mimeType && ALLOWED_IMAGE_TYPES.has(mimeType)) image = { data: cover.data, mimeType: mimeType as ImageMimeType };
    } catch { /* A missing cover must not make the bookmark unusable. */ }
  }
  return { url: page.finalUrl.href, title, description, domain: page.finalUrl.hostname, image };
}
