import type { WorkspaceStore } from "@weaver/storage";

export type WorkspacePrincipal =
  | { kind: "browser"; browserSessionId: string }
  | { kind: "chat"; chatSessionKey: string }
  | { kind: "local-read" };

export function listProjects(store: WorkspaceStore, _principal: WorkspacePrincipal) {
  return store.catalog.listProjects();
}

export function getProject(store: WorkspaceStore, _principal: WorkspacePrincipal, projectId: string) {
  const project = store.catalog.getProject(projectId);
  if (!project) throw new Error("PROJECT_NOT_FOUND");
  return project;
}
