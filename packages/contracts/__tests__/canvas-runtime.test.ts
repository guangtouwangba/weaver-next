import { describe, expect, it } from "vitest";
import {
  CANVAS_RUNTIME_PROTOCOL_VERSION,
  browserSessionSchema,
  canvasBootstrapSchema,
  canvasMutationRequestSchema,
  canvasRuntimeDescriptorSchema,
  projectWriteLeaseSchema,
  runtimeControlRequestSchema,
  workspaceLaunchResultSchema,
} from "../src/index.js";

describe("canvas runtime contracts", () => {
  it("validates a workspace runtime descriptor without exposing a workspace path", () => {
    const descriptor = canvasRuntimeDescriptorSchema.parse({
      workspaceKey: "a".repeat(64),
      protocolVersion: CANVAS_RUNTIME_PROTOCOL_VERSION,
      buildId: "build-1",
      supervisorPid: 42,
      port: 43123,
      controlSocketName: "control.sock",
      state: "ready",
      startedAt: "2026-07-13T10:00:00.000Z",
      updatedAt: "2026-07-13T10:00:01.000Z",
    });
    expect(descriptor.port).toBe(43123);
    expect(canvasRuntimeDescriptorSchema.safeParse({ ...descriptor, workspaceDir: "/secret/workspace" }).success).toBe(false);
  });

  it("keeps trusted chat identity on the bridge control plane", () => {
    expect(runtimeControlRequestSchema.parse({
      kind: "create_launch",
      chatSessionKey: "a".repeat(64),
      projectId: "project-1",
    })).toMatchObject({ kind: "create_launch", chatSessionKey: "a".repeat(64) });
    expect(runtimeControlRequestSchema.safeParse({ kind: "create_launch", chatSessionKey: "raw-thread-id" }).success).toBe(false);
    expect(runtimeControlRequestSchema.parse({ kind: "clear_diagnostics" })).toEqual({ kind: "clear_diagnostics" });
    expect(runtimeControlRequestSchema.parse({ kind: "bridge_heartbeat", chatSessionKey: "b".repeat(64), hostLabel: "Codex" })).toMatchObject({ kind: "bridge_heartbeat", hostLabel: "Codex" });

    const launch = workspaceLaunchResultSchema.parse({
      launchUrl: "http://127.0.0.1:43123/launch/once",
      expiresAt: "2026-07-13T10:00:30.000Z",
      projectId: "project-1",
      viewId: "graph-default",
      buildId: "build-1",
      protocolVersion: CANVAS_RUNTIME_PROTOCOL_VERSION,
    });
    expect(launch.launchUrl).toContain("/launch/");
  });

  it("models durable browser sessions and one project writer lease", () => {
    const session = browserSessionSchema.parse({
      id: "browser-1",
      credentialHash: "hash",
      credentialVersion: 1,
      status: "active",
      createdAt: "2026-07-13T10:00:00.000Z",
      lastSeenAt: "2026-07-13T10:00:00.000Z",
      expiresAt: "2026-08-12T10:00:00.000Z",
    });
    const lease = projectWriteLeaseSchema.parse({
      projectId: "project-1",
      browserSessionId: session.id,
      revision: 1,
      status: "active",
      lastSeenAt: session.lastSeenAt,
    });
    expect(lease.browserSessionId).toBe(session.id);
  });

  it("rejects browser-controlled identity, workspace and agent capability fields", () => {
    const request = {
      mutationId: "mutation-1",
      projectId: "project-1",
      viewId: "graph-default",
      writerLeaseRevision: 1,
      baseGraphRevision: 2,
      operation: { action: "create_node" },
    };
    expect(canvasMutationRequestSchema.safeParse(request).success).toBe(true);
    for (const injected of [
      { workspaceDir: "/secret" },
      { chatSessionKey: "forged" },
      { agentEligible: true },
      { leaseId: "forged-chat-lease" },
    ]) expect(canvasMutationRequestSchema.safeParse({ ...request, ...injected }).success).toBe(false);
  });

  it("returns server-derived capabilities in bootstrap without raw workspace or chat identity", () => {
    const bootstrap = canvasBootstrapSchema.parse({
      protocolVersion: CANVAS_RUNTIME_PROTOCOL_VERSION,
      buildId: "build-1",
      serverVersion: "0.1.0",
      browserSession: { id: "browser-1", status: "active" },
      csrfToken: "csrf-browser-1",
      capabilities: {
        manualWrite: true,
        agentConnected: false,
        agentWrite: false,
        canTakeOver: false,
        disconnectReason: "AGENT_DISCONNECTED",
      },
      projectId: "project-1",
      viewId: "graph-default",
      writerLease: {
        projectId: "project-1",
        browserSessionId: "browser-1",
        revision: 1,
        status: "active",
        lastSeenAt: "2026-07-13T10:00:00.000Z",
      },
    });
    expect(bootstrap.capabilities.manualWrite).toBe(true);
    expect(canvasBootstrapSchema.safeParse({ ...bootstrap, workspaceDir: "/secret" }).success).toBe(false);
    expect(canvasBootstrapSchema.safeParse({ ...bootstrap, chatSessionKey: "raw-or-hashed" }).success).toBe(false);
  });
});
