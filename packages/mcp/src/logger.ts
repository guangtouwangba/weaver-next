import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { hostKind } from "./session-identity.js";

// Host-agnostic structured logging for the Weaver MCP server.
//
// An MCP stdio server MUST NOT write to stdout — that channel carries the
// JSON-RPC protocol, so a stray console.log corrupts it. So every diagnostic
// goes to two safe sinks instead:
//   1. an append-only JSONL file per process (`.weaver/logs/mcp-<pid>.jsonl`),
//      which any host or human can `tail`/grep after the fact, and
//   2. stderr (mirrored), which some hosts capture.
// A bounded in-memory ring buffer also keeps the most recent lines so the
// `weaver_get_diagnostics` tool can return them without touching the disk —
// giving Codex and Claude Code the same window into "what did the server do".

export type LogLevel = "debug" | "info" | "warn" | "error";
export interface LogEntry { ts: string; level: LogLevel; pid: number; host: string; event: string; [key: string]: unknown }

const RING_MAX = 500;
const ring: LogEntry[] = [];
const bootedAtMs = Date.now();
let logFile: string | null = null;

// The file and ring buffer always capture everything (debug+); stderr only
// mirrors at/above WEAVER_LOG_LEVEL (default "info") so a host's captured stderr
// stays readable while the on-disk JSONL keeps the full high-resolution trace.
const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const stderrThreshold = LEVEL_ORDER[(process.env.WEAVER_LOG_LEVEL as LogLevel) in LEVEL_ORDER ? (process.env.WEAVER_LOG_LEVEL as LogLevel) : "info"];

// When the host dies, its end of our stderr pipe closes and the NEXT write EPIPEs —
// but a socket delivers EPIPE ASYNCHRONOUSLY, so the try/catch around write() never
// sees it: without an 'error' listener it surfaces as an uncaughtException, and an
// uncaught handler that logs (→ writes stderr again) loops forever. That loop once
// wrote a 36 GB log file. Swallow the stream error and stop mirroring to stderr.
let stderrDead = false;
process.stderr.on("error", () => { stderrDead = true; });

/** Point the file sink at `<dir>/.weaver/logs/mcp-<pid>.jsonl`. Safe to skip on failure. */
export function initLog(dir: string): void {
  try {
    const logsDir = join(dir, ".weaver", "logs");
    mkdirSync(logsDir, { recursive: true });
    logFile = join(logsDir, `mcp-${process.pid}.jsonl`);
  } catch { logFile = null; }
}

export function currentLogFile(): string | null { return logFile; }
export function bootedAt(): number { return bootedAtMs; }

export function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const entry: LogEntry = { ts: new Date().toISOString(), level, pid: process.pid, host: hostKind() ?? "codex", event, ...fields };
  ring.push(entry);
  if (ring.length > RING_MAX) ring.shift();
  const line = JSON.stringify(entry);
  if (!stderrDead && LEVEL_ORDER[level] >= stderrThreshold) { try { process.stderr.write(`${line}\n`); } catch { stderrDead = true; } }
  if (logFile) { try { appendFileSync(logFile, `${line}\n`); } catch { /* disk full / read-only */ } }
}

export function recentEntries(limit = 100): LogEntry[] { return ring.slice(-Math.max(1, limit)); }
export function recentErrors(limit = 50): LogEntry[] { return ring.filter((entry) => entry.level === "error" || entry.level === "warn").slice(-Math.max(1, limit)); }

// A short non-crypto id to correlate a single tool call's start/end log lines.
let seq = 0;
export function nextRequestId(): string { seq = (seq + 1) % 1_000_000; return `${process.pid.toString(36)}-${seq.toString(36)}`; }

// Log tool arguments without leaking bulk content or capability tokens: keep the
// small identifying scalars, replace big/opaque values with a shape hint.
const ID_KEYS = new Set(["workspaceDir", "projectId", "viewId", "nodeId", "taskId", "changeSetId", "canvasSessionId", "actionKey", "assetId", "templateId", "status", "semanticType", "baseGraphRevision", "baseLayoutRevision"]);
const REDACT_KEYS = new Set(["token", "previewToken", "leaseId", "rpcToken"]);
export function summarizeArgs(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (REDACT_KEYS.has(key)) { out[key] = "[redacted]"; continue; }
    if (value == null) continue;
    if (ID_KEYS.has(key)) { out[key] = typeof value === "string" && value.length > 120 ? `${value.slice(0, 117)}…` : value; continue; }
    if (typeof value === "object") { out[key] = Array.isArray(value) ? `[array:${value.length}]` : "[object]"; continue; }
    if (typeof value === "string") { out[key] = value.length > 80 ? `${value.slice(0, 77)}…` : value; continue; }
    out[key] = value;
  }
  return out;
}
