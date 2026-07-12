import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { WorkspaceStore } from "@weaver/storage";
import { projectSchema } from "../shared/schemas.js";
import { defineTool, failure, result, withStore } from "../shared/tool-runtime.js";

/**
 * Asset handling: read a preview thumbnail of an imported image, and the widget's
 * own image import (`weaver_import_image_asset`, app-only). The agent/skill-side
 * image-import writes (`weaver_ingest_image`, `weaver_render_svg_image`) were
 * merged into the model-facing `weaver_import_asset` (see tools/import-asset.ts).
 * `weaver_get_asset_metadata` was model-only and is now folded into
 * weaver_read_catalog(resource:"asset.metadata").
 */
export function registerAssetsTools(server: McpServer) {
  server.registerTool("weaver_get_asset_preview", {
    title: "Get Image Asset Preview", description: "Widget-only read of a size-bounded thumbnail data URL for an image card.",
    inputSchema: { ...projectSchema.shape, assetId: z.string().min(1) }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } },
  }, defineTool(async ({ workspaceDir, projectId, assetId }) => { const output = withStore(workspaceDir, (store) => { const item = store.readAsset(assetId, true); if (item.asset.projectId !== projectId) throw new Error("ASSET_NOT_FOUND_OR_CROSS_PROJECT"); return { assetId, dataUrl: `data:image/webp;base64,${Buffer.from(item.data).toString("base64")}` }; }); return result(output); }));

  // Manually manages its own WorkspaceStore lifecycle (new WorkspaceStore/store.close()) instead of the
  // shared withStore/mutateWithStore helpers — preserved exactly as in the original file, not "fixed" here.
  server.registerTool("weaver_import_image_asset", {
    title: "Import Image Asset", description: "Widget-only import of one JPEG, PNG, WebP or GIF up to 20MB. Validates bytes, deduplicates by SHA-256 and generates a bounded WebP thumbnail without changing graphRevision.",
    inputSchema: { ...projectSchema.shape, mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]), base64: z.string().min(1).max(28 * 1024 * 1024) }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } },
  }, async ({ workspaceDir, projectId, mimeType, base64 }) => { try { const store = new WorkspaceStore(workspaceDir); try { const output = await store.importImageAsset({ projectId, mimeType, data: Buffer.from(base64, "base64") }); return result(output, output.deduplicated ? "Reused existing image asset." : "Imported image asset."); } finally { store.close(); } } catch (error) { return failure(error); } });
}
