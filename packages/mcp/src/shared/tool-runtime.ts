import { WorkspaceStore } from "@weaver/storage";
import type { SseEventHub } from "../event-hub.js";

export function result<T>(value: T, message = "OK") {
  const structuredContent = (Array.isArray(value) ? { items: value } : value) as Record<string, unknown>;
  return { content: [{ type: "text" as const, text: message }], structuredContent };
}

export function failure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true, content: [{ type: "text" as const, text: message }], structuredContent: { code: message.split(":", 1)[0], message } };
}

export function withStore<T>(workspaceDir: string, callback: (store: WorkspaceStore) => T): T {
  const store = new WorkspaceStore(workspaceDir);
  try { return callback(store); } finally { store.close(); }
}

export type MutateWithStore = <T>(workspaceDir: string, callback: (store: WorkspaceStore) => T) => T;

/** Binds `withStore` to a specific event hub so mutations notify workspace subscribers. */
export function createMutateWithStore(eventHub: SseEventHub): MutateWithStore {
  return function mutateWithStore<T>(workspaceDir: string, callback: (store: WorkspaceStore) => T): T {
    const output = withStore(workspaceDir, callback);
    eventHub.notifyWorkspace(workspaceDir);
    return output;
  };
}

/**
 * Wraps the near-universal `try { ...; return result(...); } catch (error) { return failure(error); }`
 * handler shape so tool registrars only need to write the happy-path body. Handlers that manage their
 * own resource lifecycle (manual `new WorkspaceStore` + `finally { store.close() }`) intentionally keep
 * their own try/catch instead of using this wrapper.
 */
export function defineTool<Args extends unknown[], R>(handler: (...args: Args) => R | Promise<R>) {
  return async (...args: Args) => {
    try { return await handler(...args); } catch (error) { return failure(error); }
  };
}
