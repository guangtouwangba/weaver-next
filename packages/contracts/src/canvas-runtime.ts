import { z } from "zod";

export const CANVAS_RUNTIME_PROTOCOL_VERSION = 1;

const timestampSchema = z.string().min(1);
const identifierSchema = z.string().min(1);
const hashedChatSessionKeySchema = z.string().regex(/^[a-f0-9]{64}$/);
const loopbackUrlSchema = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "http:" && url.hostname === "127.0.0.1";
}, "Canvas runtime URLs must use the IPv4 loopback origin");

export const canvasRuntimeDescriptorSchema = z.object({
  workspaceKey: z.string().regex(/^[a-f0-9]{64}$/),
  protocolVersion: z.number().int().positive(),
  buildId: identifierSchema,
  supervisorPid: z.number().int().positive(),
  port: z.number().int().min(1).max(65_535),
  controlSocketName: z.string().regex(/^[a-zA-Z0-9._-]+$/),
  state: z.enum(["starting", "ready", "upgrading", "degraded", "stopping"]),
  startedAt: timestampSchema,
  updatedAt: timestampSchema,
}).strict();

const ensureRuntimeControlSchema = z.object({
  kind: z.literal("ensure_runtime"),
  workspaceKey: z.string().regex(/^[a-f0-9]{64}$/),
  requestedBuildId: identifierSchema,
  protocolVersion: z.number().int().positive(),
}).strict();

const createLaunchControlSchema = z.object({
  kind: z.literal("create_launch"),
  chatSessionKey: hashedChatSessionKeySchema,
  projectId: identifierSchema.optional(),
  requestedViewId: identifierSchema.optional(),
}).strict();

const readBindingControlSchema = z.object({
  kind: z.literal("read_binding"),
  chatSessionKey: hashedChatSessionKeySchema,
}).strict();

const dispatchAgentOperationControlSchema = z.object({
  kind: z.literal("dispatch_agent_operation"),
  chatSessionKey: hashedChatSessionKeySchema,
  tool: identifierSchema,
  arguments: z.record(z.string(), z.unknown()),
}).strict();

const getDiagnosticsControlSchema = z.object({
  kind: z.literal("get_diagnostics"),
  errorsOnly: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).optional(),
}).strict();

const clearDiagnosticsControlSchema = z.object({ kind: z.literal("clear_diagnostics") }).strict();

const recordSurfaceFallbackControlSchema = z.object({
  kind: z.literal("record_surface_fallback"),
  code: z.string().regex(/^[A-Z0-9_]{1,80}$/),
}).strict();

const bridgeHeartbeatControlSchema = z.object({
  kind: z.literal("bridge_heartbeat"),
  chatSessionKey: hashedChatSessionKeySchema,
  hostLabel: z.enum(["Codex", "Claude"]).optional(),
}).strict();

const shutdownIfIdleControlSchema = z.object({ kind: z.literal("shutdown_if_idle") }).strict();

export const runtimeControlRequestSchema = z.discriminatedUnion("kind", [
  ensureRuntimeControlSchema,
  createLaunchControlSchema,
  readBindingControlSchema,
  dispatchAgentOperationControlSchema,
  getDiagnosticsControlSchema,
  clearDiagnosticsControlSchema,
  recordSurfaceFallbackControlSchema,
  bridgeHeartbeatControlSchema,
  shutdownIfIdleControlSchema,
]);

export const workspaceLaunchResultSchema = z.object({
  launchUrl: loopbackUrlSchema,
  expiresAt: timestampSchema,
  projectId: identifierSchema.optional(),
  viewId: identifierSchema.optional(),
  buildId: identifierSchema,
  protocolVersion: z.number().int().positive(),
}).strict();

export const browserSessionSchema = z.object({
  id: identifierSchema,
  credentialHash: identifierSchema,
  credentialVersion: z.number().int().positive(),
  status: z.enum(["active", "detached", "expired"]),
  pairedChatSessionKey: identifierSchema.optional(),
  pairedBindingRevision: z.number().int().positive().optional(),
  projectId: identifierSchema.optional(),
  viewId: identifierSchema.optional(),
  createdAt: timestampSchema,
  lastSeenAt: timestampSchema,
  expiresAt: timestampSchema,
}).strict();

export const browserSessionPublicSchema = browserSessionSchema.pick({ id: true, status: true });

export const projectWriteLeaseSchema = z.object({
  projectId: identifierSchema,
  browserSessionId: identifierSchema,
  revision: z.number().int().positive(),
  status: z.enum(["active", "released"]),
  lastSeenAt: timestampSchema,
}).strict();

export const canvasCapabilitiesSchema = z.object({
  manualWrite: z.boolean(),
  agentConnected: z.boolean(),
  agentWrite: z.boolean(),
  canTakeOver: z.boolean(),
  hostLabel: z.enum(["Codex", "Claude"]).optional(),
  disconnectReason: identifierSchema.optional(),
}).strict();

export const canvasChatBindingSchema = z.object({
  leaseId: identifierSchema,
  bindingRevision: z.number().int().nonnegative(),
  projectId: identifierSchema.optional(),
  viewId: identifierSchema.optional(),
}).strict();

export const canvasBootstrapSchema = z.object({
  protocolVersion: z.number().int().positive(),
  buildId: identifierSchema,
  serverVersion: identifierSchema,
  browserSession: browserSessionPublicSchema,
  csrfToken: identifierSchema,
  capabilities: canvasCapabilitiesSchema,
  projectId: identifierSchema.optional(),
  viewId: identifierSchema.optional(),
  writerLease: projectWriteLeaseSchema.optional(),
  chatBinding: canvasChatBindingSchema.optional(),
  graphRevision: z.number().int().nonnegative().optional(),
  layoutRevision: z.number().int().nonnegative().optional(),
  viewCatalogRevision: z.number().int().nonnegative().optional(),
}).strict();

export const canvasMutationRequestSchema = z.object({
  mutationId: identifierSchema,
  projectId: identifierSchema,
  viewId: identifierSchema.optional(),
  writerLeaseRevision: z.number().int().positive(),
  baseGraphRevision: z.number().int().nonnegative().optional(),
  baseLayoutRevision: z.number().int().nonnegative().optional(),
  baseViewCatalogRevision: z.number().int().nonnegative().optional(),
  operation: z.record(z.string(), z.unknown()),
}).strict();

export const canvasMutationRecordSchema = z.object({
  id: identifierSchema,
  projectId: identifierSchema,
  viewId: identifierSchema.optional(),
  browserSessionId: identifierSchema,
  kind: z.enum(["graph", "layout", "view", "mixed"]),
  baseGraphRevision: z.number().int().nonnegative().optional(),
  resultGraphRevision: z.number().int().nonnegative().optional(),
  baseLayoutRevision: z.number().int().nonnegative().optional(),
  resultLayoutRevision: z.number().int().nonnegative().optional(),
  baseViewCatalogRevision: z.number().int().nonnegative().optional(),
  resultViewCatalogRevision: z.number().int().nonnegative().optional(),
  forwardOperations: z.array(z.unknown()),
  inverseOperations: z.array(z.unknown()),
  status: z.enum(["applied", "reverted"]),
  createdAt: timestampSchema,
  revertedAt: timestampSchema.optional(),
}).strict();

export const canvasErrorCodeSchema = z.enum([
  "SERVICE_START_FAILED",
  "WORKSPACE_UNAVAILABLE",
  "BUILD_MISMATCH",
  "PROTOCOL_MISMATCH",
  "SCHEMA_MIGRATION_FAILED",
  "PAIRING_EXPIRED",
  "PAIRING_ALREADY_CLAIMED",
  "BROWSER_NAVIGATION_FAILED",
  "CANVAS_BOOTSTRAP_FAILED",
  "SESSION_TAKEN_OVER",
  "PROJECT_WRITER_EXISTS",
  "AGENT_DISCONNECTED",
  "BOUND_CANVAS_OFFLINE",
  "STREAM_RECOVERY_FAILED",
  "UNDO_REVISION_CONFLICT",
]);

export const canvasErrorEnvelopeSchema = z.object({
  code: canvasErrorCodeSchema,
  message: z.string().min(1),
  stage: identifierSchema,
  retryable: z.boolean(),
  buildId: identifierSchema.optional(),
  protocolVersion: z.number().int().positive().optional(),
  projectId: identifierSchema.optional(),
  viewId: identifierSchema.optional(),
  graphRevision: z.number().int().nonnegative().optional(),
  layoutRevision: z.number().int().nonnegative().optional(),
  recoveryActions: z.array(identifierSchema).min(1),
}).strict();

export type CanvasRuntimeDescriptor = z.infer<typeof canvasRuntimeDescriptorSchema>;
export type RuntimeControlRequest = z.infer<typeof runtimeControlRequestSchema>;
export type WorkspaceLaunchResult = z.infer<typeof workspaceLaunchResultSchema>;
export type BrowserSession = z.infer<typeof browserSessionSchema>;
export type BrowserSessionPublic = z.infer<typeof browserSessionPublicSchema>;
export type ProjectWriteLease = z.infer<typeof projectWriteLeaseSchema>;
export type CanvasCapabilities = z.infer<typeof canvasCapabilitiesSchema>;
export type CanvasChatBinding = z.infer<typeof canvasChatBindingSchema>;
export type CanvasBootstrap = z.infer<typeof canvasBootstrapSchema>;
export type CanvasMutationRequest = z.infer<typeof canvasMutationRequestSchema>;
export type CanvasMutationRecord = z.infer<typeof canvasMutationRecordSchema>;
export type CanvasErrorEnvelope = z.infer<typeof canvasErrorEnvelopeSchema>;
