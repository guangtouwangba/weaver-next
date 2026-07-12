import type { ZodTypeAny } from "zod";

/**
 * The MCP SDK reconstructs `z.object(rawShape)` for `tools/list` and strips any
 * object-level `.superRefine`/`.refine`, so a tool that needs cross-field
 * validation must register the plain raw shape and re-validate the parsed args
 * against the refined schema INSIDE the handler. This throws the first refine
 * issue's message as an Error (so `defineTool`/`failure` surface a clean typed
 * code) instead of leaking a raw ZodError blob.
 *
 * SAFETY: the "re-parsing the already-parsed args can't diverge" guarantee holds
 * ONLY while the shape contains no `z.coerce`/`.transform` (which would mutate
 * values on each parse). Keep refined shapes coercion/transform-free.
 */
export function parseRefined<T>(schema: ZodTypeAny, rawArgs: unknown): T {
  const parsed = schema.safeParse(rawArgs);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "INVALID_ARGS");
  return parsed.data as T;
}
