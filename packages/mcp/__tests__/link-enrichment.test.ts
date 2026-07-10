import { describe, expect, it, vi } from "vitest";
import { enrichPublicLink } from "../src/link-enrichment.js";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

describe("secure link enrichment", () => {
  it("extracts title, description and an optional cover", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => String(url).endsWith("cover.png")
      ? new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } })
      : new Response('<html><head><meta property="og:title" content="Weaver reference"><meta name="description" content="A useful source"><meta property="og:image" content="/cover.png"></head></html>', { headers: { "content-type": "text/html" } }));
    const result = await enrichPublicLink("https://example.com/article", { fetchImpl: fetchImpl as typeof fetch, lookupImpl: publicLookup });
    expect(result).toMatchObject({ title: "Weaver reference", description: "A useful source", domain: "example.com" });
    expect(result.image?.mimeType).toBe("image/png");
  });

  it("blocks localhost and redirects to private networks", async () => {
    await expect(enrichPublicLink("http://localhost/private", { fetchImpl: fetch, lookupImpl: publicLookup })).rejects.toThrow("LINK_PRIVATE_HOST_BLOCKED");
    const redirectingFetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://192.168.1.10/secret" } }));
    await expect(enrichPublicLink("https://example.com", { fetchImpl: redirectingFetch as typeof fetch, lookupImpl: publicLookup })).rejects.toThrow("LINK_PRIVATE_HOST_BLOCKED");
  });

  it("keeps the bookmark usable when the cover cannot be loaded", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => String(url).endsWith("missing.jpg")
      ? new Response("missing", { status: 404 })
      : new Response('<title>Plain page</title><meta property="og:image" content="/missing.jpg">', { headers: { "content-type": "text/html" } }));
    const result = await enrichPublicLink("https://example.com", { fetchImpl: fetchImpl as typeof fetch, lookupImpl: publicLookup });
    expect(result.title).toBe("Plain page");
    expect(result.image).toBeUndefined();
  });
});
