import { normalizeWeaverFailure } from "@weaver/contracts";

export function result<T>(value: T, message = "OK") {
  const structuredContent = (Array.isArray(value) ? { items: value } : value) as Record<string, unknown>;
  return { content: [{ type: "text" as const, text: message }], structuredContent };
}

export function failure(error: unknown) {
  const value = normalizeWeaverFailure(error);
  return { isError: true, content: [{ type: "text" as const, text: value.message }], structuredContent: value };
}

/**
 * Wraps the near-universal `try { ...; return result(...); } catch (error) { return failure(error); }`
 * handler shape so tool registrars only need to write the happy-path body.
 */
export function defineTool<Args extends unknown[], R>(handler: (...args: Args) => R | Promise<R>) {
  return async (...args: Args) => {
    try { return await handler(...args); } catch (error) { return failure(error); }
  };
}
