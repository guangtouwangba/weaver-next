import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { WorkspaceStore } from "@weaver/storage";
import { projectSchema } from "../shared/schemas.js";
import { defineTool, failure, result, withStore } from "../shared/tool-runtime.js";

/** Asset handling: read metadata/preview of an imported image, and import new image bytes. */
export function registerAssetsTools(server: McpServer) {
  server.registerTool("weaver_get_asset_metadata", {
    title: "Get Image Asset Metadata", description: "Read safe metadata for a project-local image asset without loading its original binary.",
    inputSchema: { ...projectSchema.shape, assetId: z.string().min(1) }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, defineTool(async ({ workspaceDir, projectId, assetId }) => { const asset = withStore(workspaceDir, (store) => store.getAsset(assetId)); if (!asset || asset.projectId !== projectId) throw new Error("ASSET_NOT_FOUND_OR_CROSS_PROJECT"); return result(asset); }));

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

  server.registerTool("weaver_ingest_image", {
    title: "Ingest Image (skill)", description: "Import raw image bytes (base64) produced by an imagegen skill into the project's asset store and return an assetId to reference from a ChangeSet add-node image op. Content-addressed and deduplicated; validates that the declared mimeType matches the real bytes; does not change graphRevision.",
    inputSchema: { ...projectSchema.shape, mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]), base64: z.string().min(1).max(28 * 1024 * 1024) }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ workspaceDir, projectId, mimeType, base64 }) => { try { const store = new WorkspaceStore(workspaceDir); try { const output = await store.importImageAsset({ projectId, mimeType, data: Buffer.from(base64, "base64") }); return result({ assetId: output.asset.id, width: output.asset.width, height: output.asset.height, deduplicated: output.deduplicated }, output.deduplicated ? "Reused existing image asset." : "Imported image asset."); } finally { store.close(); } } catch (error) { return failure(error); } });
}
