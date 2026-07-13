import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

type DiagnosticValue = null | boolean | number | string | DiagnosticValue[] | { [key: string]: DiagnosticValue };
export type RuntimeDiagnostic = { at: string; component: string; event: string; [key: string]: DiagnosticValue };

const SECRET_KEY = /(token|cookie|nonce|lease|credential|secret|password|authorization|thread|chatSessionKey|prompt|content|markdown|title)/i;
const PATH_KEY = /(path|dir|directory|workspace)/i;
const ABSOLUTE_PATH = /(?:^|\s)(?:\/[\w .~@%+,:=-]+(?:\/[\w .~@%+,:=-]+)+|[A-Za-z]:\\[^\s]+)/g;

function redact(value: unknown, key = ""): DiagnosticValue {
  if (SECRET_KEY.test(key)) return "[redacted]";
  if (PATH_KEY.test(key)) return "[redacted-path]";
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.replace(ABSOLUTE_PATH, " [redacted-path]").slice(0, 500);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redact(item));
  if (typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 100).map(([name, item]) => [name, redact(item, name)]));
  return String(value).slice(0, 500);
}

export class RuntimeDiagnostics {
  readonly directory: string;
  readonly path: string;
  readonly component: string;
  #maxBytes: number;
  #maxFiles: number;
  #retentionMs: number;

  constructor(workspaceDir: string, component: string, options: { maxBytes?: number; maxFiles?: number; retentionMs?: number } = {}) {
    this.directory = join(workspaceDir, ".weaver", "logs");
    this.path = join(this.directory, "runtime.jsonl");
    this.component = component;
    this.#maxBytes = options.maxBytes ?? 1_048_576;
    this.#maxFiles = Math.max(1, Math.min(3, options.maxFiles ?? 3));
    this.#retentionMs = options.retentionMs ?? 7 * 24 * 60 * 60 * 1_000;
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    chmodSync(this.directory, 0o700);
    this.#removeExpired();
  }

  record(event: string, fields: Record<string, unknown> = {}) {
    const entry = redact({ at: new Date().toISOString(), component: this.component, event, ...fields }) as RuntimeDiagnostic;
    const line = `${JSON.stringify(entry)}\n`;
    if (existsSync(this.path) && statSync(this.path).size + Buffer.byteLength(line) > this.#maxBytes) this.#rotate();
    appendFileSync(this.path, line, { mode: 0o600 });
    chmodSync(this.path, 0o600);
    return entry;
  }

  export(limit = 200): RuntimeDiagnostic[] {
    const entries: RuntimeDiagnostic[] = [];
    const files = Array.from({ length: this.#maxFiles - 1 }, (_, index) => join(this.directory, `runtime.${this.#maxFiles - index - 1}.jsonl`)).concat(this.path);
    for (const file of files) {
      if (!existsSync(file)) continue;
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (!line) continue;
        try { entries.push(redact(JSON.parse(line)) as RuntimeDiagnostic); } catch { /* skip truncated/corrupt lines */ }
      }
    }
    return entries.slice(-Math.max(1, Math.min(1_000, limit)));
  }

  clear() {
    for (const name of readdirSync(this.directory)) if (/^runtime(?:\.\d+)?\.jsonl$/.test(name)) rmSync(join(this.directory, name), { force: true });
  }

  #rotate() {
    if (this.#maxFiles === 1) { rmSync(this.path, { force: true }); return; }
    rmSync(join(this.directory, `runtime.${this.#maxFiles - 1}.jsonl`), { force: true });
    for (let index = this.#maxFiles - 2; index >= 1; index -= 1) {
      const source = join(this.directory, `runtime.${index}.jsonl`);
      if (existsSync(source)) renameSync(source, join(this.directory, `runtime.${index + 1}.jsonl`));
    }
    if (existsSync(this.path)) renameSync(this.path, join(this.directory, "runtime.1.jsonl"));
  }

  #removeExpired() {
    const cutoff = Date.now() - this.#retentionMs;
    for (const name of readdirSync(this.directory)) {
      if (!/^runtime(?:\.\d+)?\.jsonl$/.test(name)) continue;
      const file = join(this.directory, name);
      if (statSync(file).mtimeMs < cutoff) rmSync(file, { force: true });
    }
  }
}
