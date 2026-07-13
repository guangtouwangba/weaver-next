import { WorkspaceWorker } from "@weaver/workspace-service";

type WorkerCommand = { id: number; kind: "create_launch" | "read_binding" | "dispatch" | "heartbeat" | "diagnostics" | "set_public_origin" | "quiesce" | "resume" | "close"; payload?: Record<string, unknown> };

export async function runWorkspaceWorkerProcess(options: { workspaceDir: string; buildId: string }) {
  if (!process.send) throw new Error("WORKER_IPC_REQUIRED");
  const worker = new WorkspaceWorker(options);
  const origin = await worker.listen();
  process.send({ kind: "ready", origin, pid: process.pid });
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await worker.close().catch(() => undefined);
    process.exit(0);
  };
  process.on("message", async (message: WorkerCommand) => {
    if (!message || typeof message !== "object" || typeof message.id !== "number") return;
    try {
      let result: unknown;
      const payload = message.payload ?? {};
      if (message.kind === "create_launch") result = worker.createLaunch(payload as Parameters<WorkspaceWorker["createLaunch"]>[0]);
      else if (message.kind === "read_binding") result = worker.readBinding(String(payload.chatSessionKey));
      else if (message.kind === "dispatch") result = await worker.dispatchChatOperation(String(payload.chatSessionKey), String(payload.operation), (payload.arguments ?? {}) as Record<string, unknown>);
      else if (message.kind === "heartbeat") result = worker.heartbeatBridge(String(payload.chatSessionKey), payload.hostLabel === "Claude" ? "Claude" : payload.hostLabel === "Codex" ? "Codex" : undefined);
      else if (message.kind === "diagnostics") result = worker.getDiagnostics();
      else if (message.kind === "set_public_origin") { worker.setPublicOrigin(String(payload.origin)); result = { ok: true }; }
      else if (message.kind === "quiesce") result = worker.quiesce();
      else if (message.kind === "resume") result = worker.resume();
      else if (message.kind === "close") { process.send?.({ id: message.id, ok: true, result: { closed: true } }); await close(); return; }
      else throw new Error("WORKER_OPERATION_NOT_FOUND");
      process.send?.({ id: message.id, ok: true, result });
    } catch (error) {
      process.send?.({ id: message.id, ok: false, error: error instanceof Error ? error.message : "WORKER_OPERATION_FAILED" });
    }
  });
  process.once("disconnect", close);
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
}
