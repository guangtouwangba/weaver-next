import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import { assetSchema, type Asset } from "@weaver/contracts";
import { json, now, parse } from "./store-internal.js";
import { getProject } from "./projects.js";

export function getAsset(db: DatabaseSync, assetId: string) {
  const row = db.prepare("SELECT data FROM asset WHERE id = ?").get(assetId) as any;
  return row ? assetSchema.parse(parse(row.data)) : null;
}

export function getAssetByHash(db: DatabaseSync, projectId: string, sha256: string) {
  const row = db.prepare("SELECT data FROM asset WHERE project_id = ? AND sha256 = ?").get(projectId, sha256) as any;
  return row ? assetSchema.parse(parse(row.data)) : null;
}

export function readAsset(db: DatabaseSync, dataDir: string, assetId: string, thumbnail = false) {
  const asset = getAsset(db, assetId);
  if (!asset) throw new Error(`ASSET_NOT_FOUND:${assetId}`);
  const uri = thumbnail ? asset.thumbnailUri : asset.storageUri;
  const relative = uri.split("/files/")[1];
  if (!relative) throw new Error("ASSET_URI_INVALID");
  const target = resolve(dataDir, "assets", relative);
  if (!target.startsWith(resolve(dataDir, "assets"))) throw new Error("UNSAFE_ASSET_PATH");
  return { asset, data: readFileSync(target) };
}

export async function importImageAsset(db: DatabaseSync, dataDir: string, input: { projectId: string; mimeType: Asset["mimeType"]; data: Uint8Array }) {
  if (!getProject(db, input.projectId)) throw new Error(`PROJECT_NOT_FOUND:${input.projectId}`);
  if (input.data.byteLength > 20 * 1024 * 1024) throw new Error("IMAGE_TOO_LARGE:Maximum image size is 20MB");
  const data = Buffer.from(input.data);
  const sha256 = createHash("sha256").update(data).digest("hex");
  const existing = getAssetByHash(db, input.projectId, sha256);
  if (existing) return { asset: existing, deduplicated: true };
  const image = sharp(data, { animated: false, limitInputPixels: 40_000_000 });
  const metadata = await image.metadata();
  const actualMime = ({ jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" } as const)[metadata.format as "jpeg" | "png" | "webp" | "gif"];
  if (!actualMime || actualMime !== input.mimeType) throw new Error("IMAGE_TYPE_MISMATCH:Only JPEG, PNG, WebP and GIF are supported");
  if (!metadata.width || !metadata.height) throw new Error("IMAGE_DIMENSIONS_MISSING");
  const id = randomUUID();
  const extension = actualMime === "image/jpeg" ? "jpg" : actualMime.split("/")[1];
  const originalName = `original/${sha256}.${extension}`;
  const thumbnailName = `thumbnails/${sha256}.webp`;
  writeFileSync(join(dataDir, "assets", originalName), data);
  const thumbnail = await sharp(data, { animated: false, limitInputPixels: 40_000_000 }).rotate().resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  writeFileSync(join(dataDir, "assets", thumbnailName), thumbnail);
  const asset = assetSchema.parse({
    id, projectId: input.projectId, kind: "image", mimeType: actualMime, size: data.byteLength, sha256,
    width: metadata.width, height: metadata.height,
    storageUri: `weaver://projects/${input.projectId}/assets/${id}/files/${originalName}`,
    thumbnailUri: `weaver://projects/${input.projectId}/assets/${id}/files/${thumbnailName}`,
    createdAt: now(),
  });
  db.prepare("INSERT INTO asset(id, project_id, sha256, data) VALUES (?, ?, ?, ?)").run(asset.id, asset.projectId, asset.sha256, json(asset));
  return { asset, deduplicated: false };
}

export function saveTaskAsset(dataDir: string, taskId: string, fileName: string, data: Uint8Array) {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "-");
  const target = join(dataDir, "assets", "tasks", taskId, safeName);
  mkdirSync(dirname(target), { recursive: true });
  if (!resolve(target).startsWith(resolve(dataDir))) throw new Error("UNSAFE_ASSET_PATH");
  writeFileSync(target, data);
  return { assetId: randomUUID(), path: target, resourceUri: `weaver://task-assets/${taskId}/${safeName}` };
}
