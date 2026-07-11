import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";

export type WeaverRuntimeMode = "development" | "installed";
export type WidgetAsset = { path: string; data: Buffer; contentType: string };
export type WidgetBundle = { buildId: string; html: string; assets: WidgetAsset[] };

export function widgetRoot() { return process.env.WEAVER_DEV_ROOT ? resolve(process.env.WEAVER_DEV_ROOT) : process.cwd(); }
export function runtimeMode(): WeaverRuntimeMode { return process.env.WEAVER_RUNTIME_MODE === "development" ? "development" : "installed"; }

export function shouldBlockWorkspaceBuildMismatch(mode: WeaverRuntimeMode, activeBuildId: string, workspaceBuildId?: string) {
  return mode === "development" && Boolean(workspaceBuildId && workspaceBuildId !== activeBuildId);
}

function contentType(path: string) {
  return extname(path) === ".css" ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8";
}

export function widgetBundle(root = widgetRoot()): WidgetBundle {
  const dist = resolve(root, "apps", "widget", "dist");
  const html = readFileSync(resolve(dist, "index.html"), "utf8");
  const paths = [...html.matchAll(/(?:href|src)="\.\/([^"?#]+\.(?:css|js))"/g)].map((match) => match[1]);
  const assets = [...new Set(paths)].map((path) => ({ path, data: readFileSync(resolve(dist, path)), contentType: contentType(path) }));
  const hash = createHash("sha256").update(html);
  for (const asset of assets) hash.update(asset.path).update(asset.data);
  return { buildId: hash.digest("hex").slice(0, 12), html, assets };
}

export function widgetBuildId(root = widgetRoot()) { return widgetBundle(root).buildId; }

/** Codex caches app resources by URI. Include the immutable bundle id so a newly
 * installed MCP process cannot be paired with HTML cached from an older build. */
export function widgetResourceUri(buildId: string) {
  return `ui://widget/weaver/workspace-${buildId}.html`;
}

/** Modification time of the built widget entry, used to detect rebuilds in development. 0 when unbuilt. */
export function widgetDistMtimeMs(root = widgetRoot()): number {
  try { return statSync(resolve(root, "apps", "widget", "dist", "index.html")).mtimeMs; } catch { return 0; }
}

export function workspaceWidgetBuildId(workspaceDir: string) {
  const index = resolve(workspaceDir, "apps", "widget", "dist", "index.html");
  if (!existsSync(index)) return undefined;
  try { return widgetBuildId(workspaceDir); } catch { return undefined; }
}

function widgetBoot(bundle: WidgetBundle) {
  return `<script>window.__weaverEmbeddedBuildId=${JSON.stringify(bundle.buildId)};window.__weaverAssetFailure=function(){var e=document.getElementById('weaver-boot-error');if(e){e.hidden=false;e.style.display='grid'}};</script><div id="weaver-boot-error" hidden style="position:fixed;inset:0;z-index:9999;place-content:center;background:#eef1ea;color:#30362f;font:14px system-ui">Weaver 资源加载失败，请重新打开画布。</div>`;
}

/** Codex app resources must be self-contained. The iframe cannot rely on the MCP
 * process's ephemeral loopback origin for its initial JS and CSS. */
export function inlineWidgetHtml(bundle: WidgetBundle) {
  const assets = new Map(bundle.assets.map((asset) => [asset.path, asset]));
  return bundle.html
    .replace(/<link[^>]+href="\.\/([^"?#]+\.css)"[^>]*>/g, (_match, path) => `<style>${assets.get(path)?.data.toString("utf8") ?? ""}</style>`)
    .replace(/<script[^>]+src="\.\/([^"?#]+\.js)"[^>]*><\/script>/g, (_match, path) => `<script type="module">${(assets.get(path)?.data.toString("utf8") ?? "").replaceAll("</script>", "<\\/script>")}</script>`)
    .replace("<body>", `<body>${widgetBoot(bundle)}`);
}

/** Rewrite a widget bundle's HTML to load its assets from the loopback origin. Takes an
 *  explicit bundle so the HTML and the asset URLs it references always come from one snapshot. */
export function bundledWidgetHtml(assetBaseUrl: string, bundle: WidgetBundle) {
  const base = assetBaseUrl.endsWith("/") ? assetBaseUrl : `${assetBaseUrl}/`;
  return bundle.html
    .replace(/href="\.\/([^"?#]+\.css)"/g, (_match, path) => `href="${base}${path}" onerror="window.__weaverAssetFailure()"`)
    .replace(/src="\.\/([^"?#]+\.js)"/g, (_match, path) => `src="${base}${path}" onerror="window.__weaverAssetFailure()"`)
    .replace("<body>", `<body>${widgetBoot(bundle)}`);
}
