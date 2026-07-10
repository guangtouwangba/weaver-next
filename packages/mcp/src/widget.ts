import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function bundledWidgetHtml(root = process.cwd()) {
  const dist = resolve(root, "apps", "widget", "dist");
  let html = readFileSync(resolve(dist, "index.html"), "utf8");
  html = html.replace(/<link[^>]+href="\.\/([^"]+\.css)"[^>]*>/g, (_match, asset) => `<style>${readFileSync(resolve(dist, asset), "utf8")}</style>`);
  html = html.replace(/<script[^>]+src="\.\/([^"]+\.js)"[^>]*><\/script>/g, (_match, asset) => `<script type="module">${readFileSync(resolve(dist, asset), "utf8").replaceAll("</script>", "<\\/script>")}</script>`);
  return html;
}
