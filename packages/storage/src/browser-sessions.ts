import { DatabaseSync } from "node:sqlite";
import { browserSessionSchema, projectWriteLeaseSchema, type BrowserSession, type ProjectWriteLease } from "@weaver/contracts";
import { transaction } from "./migrations.js";
import { json, parse } from "./store-internal.js";
import { getChatCanvasBinding, newLeaseId, rejectBindingWork, saveChatCanvasBinding } from "./chat-canvas-binding.js";
import { appendProjectEvent } from "./project-events.js";

export function getBrowserSession(db: DatabaseSync, id: string): BrowserSession | null {
  const row = db.prepare("SELECT data FROM browser_session WHERE id = ?").get(id) as { data: string } | undefined;
  return row ? browserSessionSchema.parse(parse(row.data)) : null;
}

function saveBrowserSession(db: DatabaseSync, session: BrowserSession): BrowserSession {
  const validated = browserSessionSchema.parse(session);
  db.prepare(`
    INSERT INTO browser_session(id, status, credential_version, data) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET status=excluded.status, credential_version=excluded.credential_version, data=excluded.data
  `).run(validated.id, validated.status, validated.credentialVersion, json(validated));
  return validated;
}

export function createBrowserSession(db: DatabaseSync, input: { id: string; credentialHash: string; now: string; expiresAt: string }) {
  return transaction(db, () => {
    if (getBrowserSession(db, input.id)) throw new Error("BROWSER_SESSION_EXISTS");
    return saveBrowserSession(db, browserSessionSchema.parse({
      id: input.id,
      credentialHash: input.credentialHash,
      credentialVersion: 1,
      status: "active",
      createdAt: input.now,
      lastSeenAt: input.now,
      expiresAt: input.expiresAt,
    }));
  });
}

function requireActiveBrowserSession(db: DatabaseSync, id: string, at: string) {
  const session = getBrowserSession(db, id);
  if (!session) throw new Error("BROWSER_SESSION_NOT_FOUND");
  if (session.status !== "active" || Date.parse(session.expiresAt) <= Date.parse(at)) throw new Error("BROWSER_SESSION_NOT_ACTIVE");
  return session;
}

export function rotateBrowserCredential(db: DatabaseSync, input: { id: string; expectedVersion: number; credentialHash: string; now: string; expiresAt: string }) {
  return transaction(db, () => {
    const session = requireActiveBrowserSession(db, input.id, input.now);
    if (session.credentialVersion !== input.expectedVersion) throw new Error("BROWSER_CREDENTIAL_REPLAY");
    return saveBrowserSession(db, {
      ...session,
      credentialHash: input.credentialHash,
      credentialVersion: session.credentialVersion + 1,
      lastSeenAt: input.now,
      expiresAt: input.expiresAt,
    });
  });
}

export function pairBrowserChat(db: DatabaseSync, input: { id: string; chatSessionKey: string; bindingRevision: number; now: string }) {
  return transaction(db, () => {
    const session = requireActiveBrowserSession(db, input.id, input.now);
    return saveBrowserSession(db, {
      ...session,
      pairedChatSessionKey: input.chatSessionKey,
      pairedBindingRevision: input.bindingRevision,
      lastSeenAt: input.now,
    });
  });
}

export function getProjectWriteLease(db: DatabaseSync, projectId: string): ProjectWriteLease | null {
  const row = db.prepare("SELECT data FROM project_write_lease WHERE project_id = ?").get(projectId) as { data: string } | undefined;
  return row ? projectWriteLeaseSchema.parse(parse(row.data)) : null;
}

function saveProjectWriteLease(db: DatabaseSync, lease: ProjectWriteLease): ProjectWriteLease {
  const validated = projectWriteLeaseSchema.parse(lease);
  db.prepare(`
    INSERT INTO project_write_lease(project_id, browser_session_id, revision, status, data) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET browser_session_id=excluded.browser_session_id, revision=excluded.revision, status=excluded.status, data=excluded.data
  `).run(validated.projectId, validated.browserSessionId, validated.revision, validated.status, json(validated));
  return validated;
}

export function claimProjectWriter(db: DatabaseSync, input: { projectId: string; browserSessionId: string; now: string; takeover?: boolean }) {
  return transaction(db, () => {
    requireActiveBrowserSession(db, input.browserSessionId, input.now);
    const current = getProjectWriteLease(db, input.projectId);
    if (current?.status === "active" && current.browserSessionId === input.browserSessionId) {
      return saveProjectWriteLease(db, { ...current, lastSeenAt: input.now });
    }
    if (current?.status === "active" && !input.takeover) throw new Error("PROJECT_WRITER_EXISTS");
    if (current?.status === "active" && input.takeover) {
      const previousBrowser = getBrowserSession(db, current.browserSessionId);
      const previousBinding = previousBrowser?.pairedChatSessionKey ? getChatCanvasBinding(db, previousBrowser.pairedChatSessionKey) : null;
      if (previousBinding?.projectId === input.projectId) {
        rejectBindingWork(db, previousBinding);
        const detached = saveChatCanvasBinding(db, {
          ...previousBinding,
          bindingRevision: previousBinding.bindingRevision + 1,
          leaseId: newLeaseId(),
          status: "detached",
          lastSeenAt: input.now,
        });
        appendProjectEvent(db, {
          projectId: input.projectId,
          canvasSessionId: previousBinding.canvasSessionId,
          kind: "chat.binding.changed",
          payload: { bindingRevision: detached.bindingRevision, status: "detached", reason: "PROJECT_WRITER_TAKEN_OVER" },
          createdAt: input.now,
        });
      }
    }
    return saveProjectWriteLease(db, {
      projectId: input.projectId,
      browserSessionId: input.browserSessionId,
      revision: (current?.revision ?? 0) + 1,
      status: "active",
      lastSeenAt: input.now,
    });
  });
}

export function expireBrowserSession(db: DatabaseSync, id: string, at: string) {
  return transaction(db, () => {
    const session = getBrowserSession(db, id);
    if (!session) throw new Error("BROWSER_SESSION_NOT_FOUND");
    const expired = saveBrowserSession(db, { ...session, status: "expired", lastSeenAt: at });
    const rows = db.prepare("SELECT data FROM project_write_lease WHERE browser_session_id = ? AND status = 'active'").all(id) as Array<{ data: string }>;
    for (const row of rows) {
      const lease = projectWriteLeaseSchema.parse(parse(row.data));
      saveProjectWriteLease(db, { ...lease, revision: lease.revision + 1, status: "released", lastSeenAt: at });
    }
    return expired;
  });
}
