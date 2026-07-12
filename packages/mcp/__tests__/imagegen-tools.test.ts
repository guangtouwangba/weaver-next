import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { getScenePack } from "@weaver/scene-packs";
import { WorkspaceStore } from "@weaver/storage";
import { createWeaverServer, type WeaverServer } from "../src/create-server.js";

// 1x1 opaque PNG.
const PNG_1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const roots: string[] = [];
const servers: WeaverServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

async function setup() {
  const root = mkdtempSync(join(tmpdir(), "weaver-imagegen-")); roots.push(root); mkdirSync(root, { recursive: true });
  const scene = getScenePack("entity-relationship")!;
  const store = new WorkspaceStore(root);
  const project = store.createProject({ title: "Imagegen", goal: "", scenePack: scene });
  store.close();
  const server = await createWeaverServer({ previewWorkspaceDir: root }); servers.push(server);
  return { root, server, project };
}

describe("weaver_ingest_image", () => {
  it("imports base64 image bytes and returns an assetId", async () => {
    const { root, server, project } = await setup();
    const res = await server.dispatch("weaver_ingest_image", { workspaceDir: root, projectId: project.id, mimeType: "image/png", base64: PNG_1x1 }) as any;
    expect(res.structuredContent.assetId).toMatch(/.+/);
    expect(res.structuredContent).toMatchObject({ width: 1, height: 1 });
  });

  it("deduplicates identical bytes", async () => {
    const { root, server, project } = await setup();
    const a = await server.dispatch("weaver_ingest_image", { workspaceDir: root, projectId: project.id, mimeType: "image/png", base64: PNG_1x1 }) as any;
    const b = await server.dispatch("weaver_ingest_image", { workspaceDir: root, projectId: project.id, mimeType: "image/png", base64: PNG_1x1 }) as any;
    expect(b.structuredContent.assetId).toBe(a.structuredContent.assetId);
    expect(b.structuredContent.deduplicated).toBe(true);
  });

  it("rejects bytes whose real format contradicts the declared mimeType", async () => {
    const { root, server, project } = await setup();
    const res = await server.dispatch("weaver_ingest_image", { workspaceDir: root, projectId: project.id, mimeType: "image/jpeg", base64: PNG_1x1 }) as any;
    expect(res.isError).toBe(true);
  });
});
