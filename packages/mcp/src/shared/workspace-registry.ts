// Process-level lookup so MCP resource templates (weaver://projects/{projectId}/..., weaver://agent-tasks/{taskId})
// can resolve which on-disk workspace a projectId/taskId belongs to without the client repeating workspaceDir.
export const workspaceByProject = new Map<string, string>();
export const workspaceByTask = new Map<string, string>();

export function track(workspaceDir: string, projectId: string) {
  workspaceByProject.set(projectId, workspaceDir);
}
