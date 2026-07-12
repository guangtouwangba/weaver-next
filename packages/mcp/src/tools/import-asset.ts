import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { workspaceSchema } from "../shared/schemas.js";
import { parseRefined } from "../shared/refined-args.js";
import { importImageBytes, importSvgImage } from "../shared/import-asset.js";
import { defineTool } from "../shared/tool-runtime.js";

/** The raw input shape the MCP SDK wraps in `z.object(...)` (registerTool needs a
 * ZodRawShape, not a refined schema). The per-source required-param validation
 * lives on `importAssetSchema` below and is re-run in the handler. The mimeType
 * enum and byte/size bounds of the originals are preserved verbatim; only
 * requiredness becomes source-gated. */
const importAssetShape = {
  ...workspaceSchema.shape,
  projectId: z.string(),
  source: z.enum(["bytes", "svg"]),
  // source === "bytes" (← weaver_ingest_image):
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]).optional(),
  base64: z.string().min(1).max(28 * 1024 * 1024).optional(),
  // source === "svg" (← weaver_render_svg_image):
  svg: z.string().min(1).max(2 * 1024 * 1024).optional(),
  scale: z.number().min(1).max(3).default(2),
} as const;

/**
 * Per-source required params. The MCP SDK strips object-level superRefines from
 * the registered shape, so re-validate the refined schema in the handler (see
 * refined-args). Each branch mirrors the required inputs of the tool it replaces:
 * bytes ← weaver_ingest_image (mimeType + base64), svg ← weaver_render_svg_image (svg).
 */
const importAssetSchema = z.object(importAssetShape).superRefine((value, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if (value.source === "bytes") {
    if (!value.mimeType) fail("IMPORT_ASSET_REQUIRES_mimeType");
    if (!value.base64) fail("IMPORT_ASSET_REQUIRES_base64");
  } else {
    // source === "svg"
    if (!value.svg) fail("IMPORT_ASSET_REQUIRES_svg");
  }
});

/**
 * One model-facing WRITE tool that merges the two agent/skill-side image-import
 * writes (both model-only, now removed): `weaver_ingest_image`
 * (`source:"bytes"`) and `weaver_render_svg_image` (`source:"svg"`). Both paths
 * delegate to shared/import-asset.ts, preserving each old handler's asset-store
 * calls, content-hash dedup, dimension extraction and `{assetId,...}` payload so
 * skills that reference `assetId` for a ChangeSet add-node op keep working.
 * NOTE: `weaver_import_image_asset` (the widget's own image import) is a DIFFERENT,
 * app-only tool and is intentionally untouched here.
 */
export function registerImportAssetTool(server: McpServer) {
  server.registerTool("weaver_import_asset", {
    title: "Import Asset (skill)",
    description: "Import an image produced by an imagegen skill into the project's asset store and return an `assetId` to reference from a ChangeSet add-node image op. `source:\"bytes\"` + `mimeType` + `base64` imports raw image bytes (content-addressed, deduplicated; validates the declared mimeType against the real bytes). `source:\"svg\"` + `svg` (+`scale`, default 2) rasterizes an agent-authored SVG to a PNG — use for crisp-text infographics/covers and on hosts without a built-in image model. Neither changes graphRevision.",
    inputSchema: importAssetShape,
    // idempotentHint:true — both merged writes are content-hash deduplicated (same
    // bytes/SVG → same assetId, no new asset), matching what weaver_ingest_image
    // and weaver_render_svg_image both declared.
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, defineTool(async (rawArgs) => {
    const args = parseRefined<z.infer<typeof importAssetSchema>>(importAssetSchema, rawArgs);
    if (args.source === "bytes") {
      return importImageBytes({ workspaceDir: args.workspaceDir, projectId: args.projectId, mimeType: args.mimeType!, base64: args.base64! });
    }
    return importSvgImage({ workspaceDir: args.workspaceDir, projectId: args.projectId, svg: args.svg!, scale: args.scale });
  }));
}
