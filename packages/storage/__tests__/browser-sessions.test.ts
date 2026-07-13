import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceStore } from "../src/workspace-store.js";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

function store() {
  const root = mkdtempSync(join(tmpdir(), "weaver-browser-session-")); roots.push(root);
  return new WorkspaceStore(root);
}

const at = "2026-07-13T10:00:00.000Z";
const later = "2026-07-13T10:01:00.000Z";
const expires = "2026-08-12T10:00:00.000Z";

describe("browser sessions and project writer leases", () => {
  it("persists and rotates only the hashed browser credential", () => {
    const db = store();
    const created = db.browserSessions.create({ id: "browser-a", credentialHash: "hash-v1", now: at, expiresAt: expires });
    expect(created).toMatchObject({ id: "browser-a", credentialHash: "hash-v1", credentialVersion: 1, status: "active" });

    const rotated = db.browserSessions.rotateCredential({ id: created.id, expectedVersion: 1, credentialHash: "hash-v2", now: later, expiresAt: expires });
    expect(rotated).toMatchObject({ credentialHash: "hash-v2", credentialVersion: 2, lastSeenAt: later });
    expect(() => db.browserSessions.rotateCredential({ id: created.id, expectedVersion: 1, credentialHash: "replay", now: later, expiresAt: expires })).toThrowError("BROWSER_CREDENTIAL_REPLAY");
    expect(JSON.stringify(db.browserSessions.get(created.id))).not.toContain("raw-credential");
    db.close();
  });

  it("allows one writer per project and requires explicit takeover", () => {
    const db = store();
    db.browserSessions.create({ id: "browser-a", credentialHash: "a", now: at, expiresAt: expires });
    db.browserSessions.create({ id: "browser-b", credentialHash: "b", now: at, expiresAt: expires });
    const chatSessionKey = "a".repeat(64);
    const binding = db.sessions.openBinding({ chatSessionKey, projectId: "project-1" });
    db.browserSessions.pairChat({ id: "browser-a", chatSessionKey, bindingRevision: binding.bindingRevision, now: at });

    const first = db.browserSessions.claimWriter({ projectId: "project-1", browserSessionId: "browser-a", now: at });
    expect(first).toMatchObject({ revision: 1, browserSessionId: "browser-a", status: "active" });
    expect(db.browserSessions.claimWriter({ projectId: "project-1", browserSessionId: "browser-a", now: later })).toMatchObject({ revision: 1 });
    expect(() => db.browserSessions.claimWriter({ projectId: "project-1", browserSessionId: "browser-b", now: later })).toThrowError("PROJECT_WRITER_EXISTS");

    const taken = db.browserSessions.claimWriter({ projectId: "project-1", browserSessionId: "browser-b", now: later, takeover: true });
    expect(taken).toMatchObject({ revision: 2, browserSessionId: "browser-b", status: "active" });
    expect(db.browserSessions.writer("project-1")).toEqual(taken);
    expect(db.sessions.getBinding(chatSessionKey)).toMatchObject({ bindingRevision: binding.bindingRevision + 1, status: "detached" });
    expect(db.sessions.listEvents("project-1").at(-1)).toMatchObject({ kind: "chat.binding.changed", payload: { reason: "PROJECT_WRITER_TAKEN_OVER" } });
    db.close();
  });

  it("allows one browser session to write another project independently", () => {
    const db = store();
    db.browserSessions.create({ id: "browser-a", credentialHash: "a", now: at, expiresAt: expires });
    db.browserSessions.create({ id: "browser-b", credentialHash: "b", now: at, expiresAt: expires });
    db.browserSessions.claimWriter({ projectId: "project-1", browserSessionId: "browser-a", now: at });
    expect(db.browserSessions.claimWriter({ projectId: "project-2", browserSessionId: "browser-b", now: at })).toMatchObject({ projectId: "project-2", revision: 1 });
    db.close();
  });

  it("releases every writer lease when a browser session expires", () => {
    const db = store();
    db.browserSessions.create({ id: "browser-a", credentialHash: "a", now: at, expiresAt: expires });
    db.browserSessions.claimWriter({ projectId: "project-1", browserSessionId: "browser-a", now: at });
    db.browserSessions.claimWriter({ projectId: "project-2", browserSessionId: "browser-a", now: at });

    expect(db.browserSessions.expire("browser-a", later)).toMatchObject({ status: "expired" });
    expect(db.browserSessions.writer("project-1")).toMatchObject({ status: "released" });
    expect(db.browserSessions.writer("project-2")).toMatchObject({ status: "released" });
    expect(() => db.browserSessions.claimWriter({ projectId: "project-3", browserSessionId: "browser-a", now: later })).toThrowError("BROWSER_SESSION_NOT_ACTIVE");
    db.close();
  });

  it("pairs a browser session to a hashed chat binding without accepting a raw thread id", () => {
    const db = store();
    db.browserSessions.create({ id: "browser-a", credentialHash: "a", now: at, expiresAt: expires });
    const paired = db.browserSessions.pairChat({ id: "browser-a", chatSessionKey: "hashed-chat", bindingRevision: 3, now: later });
    expect(paired).toMatchObject({ pairedChatSessionKey: "hashed-chat", pairedBindingRevision: 3 });
    expect(JSON.stringify(paired)).not.toContain("threadId");
    db.close();
  });
});
