// In-process signal bridge between the widget's canvas-prompt submit (loopback RPC)
// and the terminal agent's long-poll await (stdio) — both run in the same MCP process,
// so a workspace-keyed waiter set lets await return the instant a prompt is submitted.
type Waiter = () => void;

const waiters = new Map<string, Set<Waiter>>();

/** Wake any await-loops watching this workspace (called after a prompt is submitted). */
export function notifyCanvasPrompt(workspaceDir: string) {
  const set = waiters.get(workspaceDir);
  if (!set) return;
  for (const waiter of [...set]) waiter();
}

/** Resolve when a prompt is submitted for this workspace, or after `timeoutMs`. */
export function awaitCanvasPromptSignal(workspaceDir: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let set = waiters.get(workspaceDir);
    if (!set) { set = new Set(); waiters.set(workspaceDir, set); }
    const done = () => {
      set!.delete(done);
      if (set!.size === 0) waiters.delete(workspaceDir);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    if (typeof timer.unref === "function") timer.unref();
    set.add(done);
  });
}
