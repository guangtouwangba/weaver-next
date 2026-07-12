import sharp from "sharp";
import { WorkspaceStore } from "@weaver/storage";
import { result } from "./tool-runtime.js";

/**
 * Single source of truth for the two agent/skill-side image-import writes merged
 * into the model-facing `weaver_import_asset` tool: `source:"bytes"` (formerly
 * `weaver_ingest_image`) and `source:"svg"` (formerly `weaver_render_svg_image`).
 * Each helper reproduces the exact store calls, mimeType-vs-bytes validation,
 * content-hash dedup, dimension extraction and `{assetId,...}` payload of the
 * handler it replaces — verbatim — so skills that reference `assetId` for a
 * ChangeSet add-node image op keep working. Both manage their own
 * WorkspaceStore lifecycle (matching the originals) rather than using withStore.
 */

/** weaver_ingest_image core: import raw base64 image bytes as a content-addressed,
 * deduplicated asset; the store validates the declared mimeType against the real
 * bytes and does not change graphRevision. */
export async function importImageBytes(args: { workspaceDir: string; projectId: string; mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; base64: string }) {
  const store = new WorkspaceStore(args.workspaceDir);
  try {
    const output = await store.importImageAsset({ projectId: args.projectId, mimeType: args.mimeType, data: Buffer.from(args.base64, "base64") });
    return result({ assetId: output.asset.id, width: output.asset.width, height: output.asset.height, deduplicated: output.deduplicated }, output.deduplicated ? "Reused existing image asset." : "Imported image asset.");
  } finally { store.close(); }
}

/** weaver_render_svg_image core: rasterize an agent-authored SVG to a PNG at the
 * given scale and import it as a project asset. Deterministic; does not change
 * graphRevision. */
export async function importSvgImage(args: { workspaceDir: string; projectId: string; svg: string; scale: number }) {
  const png = await sharp(Buffer.from(args.svg), { density: Math.round(96 * args.scale) }).png().toBuffer();
  const store = new WorkspaceStore(args.workspaceDir);
  try {
    const output = await store.importImageAsset({ projectId: args.projectId, mimeType: "image/png", data: png });
    return result({ assetId: output.asset.id, width: output.asset.width, height: output.asset.height }, "Rendered SVG to image asset.");
  } finally { store.close(); }
}
