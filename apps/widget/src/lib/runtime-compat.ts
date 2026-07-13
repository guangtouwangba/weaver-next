export type RuntimeIdentity = { buildId: string; protocolVersion: number };

export function assertRuntimeCompatibility(expected: RuntimeIdentity, actual: Partial<RuntimeIdentity>) {
  if (actual.protocolVersion !== expected.protocolVersion) throw new Error("PROTOCOL_MISMATCH");
  if (actual.buildId !== expected.buildId) throw new Error("BUILD_MISMATCH");
}
