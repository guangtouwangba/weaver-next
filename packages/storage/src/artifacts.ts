import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { json, now, parse } from "./store-internal.js";
import { getProject } from "./projects.js";

export function publishArtifact(db: DatabaseSync, input: { projectId: string; type: string; title: string; content: unknown; sourceNodeIds: string[]; graphRevision: number }) {
  const project = getProject(db, input.projectId);
  if (!project) throw new Error("PROJECT_NOT_FOUND");
  if (project.graphRevision !== input.graphRevision) throw new Error("GRAPH_REVISION_CONFLICT");
  const artifact = { id: randomUUID(), ...input, createdAt: now(), updatedAt: now() };
  db.prepare("INSERT INTO artifact(id, project_id, type, data) VALUES (?, ?, ?, ?)").run(artifact.id, artifact.projectId, artifact.type, json(artifact));
  return artifact;
}

export function getArtifact(db: DatabaseSync, artifactId: string) {
  const row = db.prepare("SELECT data FROM artifact WHERE id = ?").get(artifactId) as any;
  return row ? parse<any>(row.data) : null;
}
