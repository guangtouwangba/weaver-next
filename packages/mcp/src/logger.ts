import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, rmSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hostKind } from "./session-identity.js";

// MCP stdout is the JSON-RPC protocol. Diagnostics therefore stay in a bounded,
// redacted memory ring. Stderr and persistent files are disabled unless the
// operator explicitly opts in with WEAVER_STDERR_LOG=1 or WEAVER_FILE_LOG=1.

export type LogLevel = "debug" | "info" | "warn" | "error";
export interface LogEntry { ts: string; level: LogLevel; pid: number; host: string; event: string; [key: string]: unknown }
export interface LogOptions {
  fileLogging?: boolean;
  fileLevel?: LogLevel;
  maxBytes?: number;
  maxFiles?: number;
  maxAgeMs?: number;
}

const RING_MAX = 200;
const DEFAULT_MAX_BYTES = 1_048_576;
const DEFAULT_MAX_FILES = 3;
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const ring: LogEntry[] = [];
const bootedAtMs = Date.now();

let logFile: string | null = null;
let logsDir: string | null = null;
let rotation = 0;
let fileThreshold = LEVEL_ORDER.warn;
let maxBytes = DEFAULT_MAX_BYTES;
let maxFiles = DEFAULT_MAX_FILES;
let maxAgeMs = DEFAULT_MAX_AGE_MS;

function levelFromEnv(name: string, fallback: LogLevel): LogLevel {
  const value = process.env[name] as LogLevel;
  return value in LEVEL_ORDER ? value : fallback;
}

let stderrDead = false;
process.stderr.on("error", () => { stderrDead = true; });

function stderrEnabled(level: LogLevel): boolean {
  return process.env.WEAVER_STDERR_LOG === "1"
    && LEVEL_ORDER[level] >= LEVEL_ORDER[levelFromEnv("WEAVER_LOG_LEVEL", "error")];
}

const SECRET_KEY = /(token|secret|password|authorization|cookie|lease|api[-_]?key)/i;
const PATH_KEY = /(^|_)(workspaceDir|cwd|logFile|path|requested|filePath|root|directory)$/i;
const SAFE_STRING_KEYS = new Set([
  "tool", "requestId", "code", "signal", "transport", "serverVersion", "hostKind", "runtimeMode",
  "buildId", "requestedBuildId", "currentBuildId", "origin", "node", "opener", "status", "actionKey",
  "projectId", "viewId", "nodeId", "taskId", "changeSetId", "canvasSessionId", "assetId", "templateId",
  "semanticType",
]);
const SIMPLE_REASON = /^[a-zA-Z0-9_.:-]{1,120}$/;
const CAPABILITY = /\b[a-f0-9]{48,}\b/gi;
const ABSOLUTE_PATH = /(?:\/[A-Za-z0-9._~ -]+){2,}/g;

function safeString(value: string, limit = 160): string {
  const scrubbed = value.replace(CAPABILITY, "[redacted]").replace(ABSOLUTE_PATH, "[redacted-path]");
  return scrubbed.length > limit ? `${scrubbed.slice(0, limit - 1)}…` : scrubbed;
}

function sanitizeValue(key: string, value: unknown): unknown {
  if (SECRET_KEY.test(key)) return "[redacted]";
  if (PATH_KEY.test(key)) return "[redacted-path]";
  if (key === "stack") return "[redacted]";
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (key === "message") return "[redacted-error]";
    if (key === "reason") return SIMPLE_REASON.test(value) ? value : "[redacted-error]";
    if (SAFE_STRING_KEYS.has(key)) return safeString(value);
    return `[string:${value.length}]`;
  }
  if (key === "args" && typeof value === "object" && !Array.isArray(value)) {
    return sanitizeFields(value as Record<string, unknown>);
  }
  if (Array.isArray(value)) return `[array:${value.length}]`;
  return "[object]";
}

function sanitizeFields(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, sanitizeValue(key, value)]));
}

function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function boundedEnvInt(name: string, fallback: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, envInt(name, fallback)));
}

function removeLegacyLogs(dir: string): void {
  const legacyDir = join(dir, ".weaver", "logs");
  if (!existsSync(legacyDir)) return;
  try {
    for (const name of readdirSync(legacyDir)) {
      if (/^mcp-.*\.jsonl$/.test(name)) rmSync(join(legacyDir, name), { force: true });
    }
    if (readdirSync(legacyDir).length === 0) rmdirSync(legacyDir);
  } catch { /* preserve operation when the workspace is read-only */ }
}

function listLogFiles(): Array<{ name: string; mtimeMs: number }> {
  if (!logsDir) return [];
  try {
    return readdirSync(logsDir)
      .filter((name) => /^mcp-.*\.jsonl$/.test(name))
      .map((name) => ({ name, mtimeMs: statSync(join(logsDir!, name)).mtimeMs }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch { return []; }
}

function pruneLogs(now = Date.now()): void {
  if (!logsDir) return;
  const files = listLogFiles();
  for (const file of files) {
    const expired = now - file.mtimeMs > maxAgeMs;
    if (expired) { try { rmSync(join(logsDir, file.name), { force: true }); } catch { /* read-only */ } }
  }
  const retained = listLogFiles();
  for (const file of retained.slice(maxFiles)) {
    if (join(logsDir, file.name) === logFile) continue;
    try { rmSync(join(logsDir, file.name), { force: true }); } catch { /* read-only */ }
  }
}

function createLogFile(): void {
  if (!logsDir) return;
  const suffix = rotation ? `-${Date.now()}-${rotation}` : "";
  logFile = join(logsDir, `mcp-${process.pid}${suffix}.jsonl`);
  writeFileSync(logFile, "", { flag: "a", mode: 0o600 });
  chmodSync(logFile, 0o600);
  pruneLogs();
}

/** Configure an optional bounded file sink under `<dir>/.weaver/logs`. */
export function initLog(dir: string, options: LogOptions = {}): void {
  logFile = null;
  logsDir = null;
  rotation = 0;
  const fileLogging = options.fileLogging ?? process.env.WEAVER_FILE_LOG === "1";
  if (!fileLogging) { removeLegacyLogs(dir); return; }
  try {
    logsDir = join(dir, ".weaver", "logs");
    mkdirSync(logsDir, { recursive: true, mode: 0o700 });
    chmodSync(logsDir, 0o700);
    fileThreshold = LEVEL_ORDER[options.fileLevel ?? levelFromEnv("WEAVER_FILE_LOG_LEVEL", "warn")];
    maxBytes = options.maxBytes ?? boundedEnvInt("WEAVER_LOG_MAX_BYTES", DEFAULT_MAX_BYTES, 4_096, 10 * 1_048_576);
    maxFiles = options.maxFiles ?? boundedEnvInt("WEAVER_LOG_MAX_FILES", DEFAULT_MAX_FILES, 1, 10);
    maxAgeMs = options.maxAgeMs ?? boundedEnvInt("WEAVER_LOG_MAX_AGE_MS", DEFAULT_MAX_AGE_MS, 60_000, 30 * 24 * 60 * 60 * 1_000);
    pruneLogs();
    createLogFile();
  } catch {
    logFile = null;
    logsDir = null;
  }
}

export function currentLogFile(): string | null { return logFile; }
export function fileLoggingEnabled(): boolean { return Boolean(logFile); }
export function bootedAt(): number { return bootedAtMs; }

function appendBounded(line: string): void {
  if (!logFile || !logsDir) return;
  try {
    const bytes = Buffer.byteLength(line) + 1;
    if (bytes > maxBytes) return;
    if (statSync(logFile).size + bytes > maxBytes) {
      rotation += 1;
      createLogFile();
    }
    appendFileSync(logFile, `${line}\n`, { encoding: "utf8", mode: 0o600 });
    pruneLogs();
  } catch { /* disk full / read-only / removed file */ }
}

export function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  const entry: LogEntry = { ts: new Date().toISOString(), level, pid: process.pid, host: hostKind() ?? "codex", event, ...sanitizeFields(fields) };
  ring.push(entry);
  if (ring.length > RING_MAX) ring.shift();
  const line = JSON.stringify(entry);
  if (!stderrDead && stderrEnabled(level)) {
    try { process.stderr.write(`${line}\n`); } catch { stderrDead = true; }
  }
  if (LEVEL_ORDER[level] >= fileThreshold) appendBounded(line);
}

export function recentEntries(limit = 100): LogEntry[] { return ring.slice(-Math.min(RING_MAX, Math.max(1, limit))); }
export function recentErrors(limit = 50): LogEntry[] { return ring.filter((entry) => entry.level === "error" || entry.level === "warn").slice(-Math.max(1, limit)); }

let seq = 0;
export function nextRequestId(): string { seq = (seq + 1) % 1_000_000; return `${process.pid.toString(36)}-${seq.toString(36)}`; }

const ID_KEYS = new Set(["projectId", "viewId", "nodeId", "taskId", "changeSetId", "canvasSessionId", "actionKey", "assetId", "templateId", "status", "semanticType", "baseGraphRevision", "baseLayoutRevision"]);
const REDACT_KEYS = new Set(["token", "previewToken", "leaseId", "rpcToken"]);
export function summarizeArgs(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (REDACT_KEYS.has(key) || SECRET_KEY.test(key)) { out[key] = "[redacted]"; continue; }
    if (key === "workspaceDir" || PATH_KEY.test(key)) { out[key] = "[redacted-path]"; continue; }
    if (value == null) continue;
    if (ID_KEYS.has(key)) { out[key] = typeof value === "string" ? safeString(value, 120) : value; continue; }
    if (typeof value === "object") { out[key] = Array.isArray(value) ? `[array:${value.length}]` : "[object]"; continue; }
    if (typeof value === "string") { out[key] = `[string:${value.length}]`; continue; }
    out[key] = value;
  }
  return out;
}

/** Test-only state reset; does not delete files. */
export function resetLoggerForTest(): void {
  ring.splice(0);
  logFile = null;
  logsDir = null;
  rotation = 0;
  fileThreshold = LEVEL_ORDER.warn;
  maxBytes = DEFAULT_MAX_BYTES;
  maxFiles = DEFAULT_MAX_FILES;
  maxAgeMs = DEFAULT_MAX_AGE_MS;
  seq = 0;
}
