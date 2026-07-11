import { execFileSync } from "node:child_process";
import { readlinkSync } from "node:fs";
import { resolve } from "node:path";

// Codex (and occasionally Claude Code) leak their MCP child process when a
// session ends: the parent dies, the launcher gets reparented to init/launchd,
// and it keeps listening on its loopback port and rewriting the shared
// `.weaver/preview.json`. Over a day that piles up a dozen zombies, and the
// last one to boot points preview.json at a port that later dies — which is
// exactly the "canvas stuck at Connecting, no data" symptom.
//
// On boot we reap those orphans, but ONLY when all three hold:
//   1. same launcher (a node process running scripts/start-mcp*.mjs),
//   2. same workspace (its cwd matches ours — never touch another repo),
//   3. orphaned (PPID 1) — a process still parented to a live Codex/Claude is
//      legitimately in use and must be left alone.
// Everything is best-effort and swallowed: reaping must never break boot, and
// this launcher feeds a stdio JSON-RPC server, so nothing may touch stdout.

/** cwd of another pid, or "" if it can't be determined. */
function processCwd(pid) {
  try {
    if (process.platform === "linux") return readlinkSync(`/proc/${pid}/cwd`);
    if (process.platform === "darwin") {
      const out = execFileSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const line = out.split("\n").find((entry) => entry.startsWith("n"));
      return line ? line.slice(1) : "";
    }
  } catch { /* pid gone, or no permission */ }
  return "";
}

export function reapStaleSiblings() {
  if (process.platform !== "darwin" && process.platform !== "linux") return;
  const self = process.pid;
  const cwd = resolve(process.cwd());
  let listing = "";
  try { listing = execFileSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }
  catch { return; }

  for (const raw of listing.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const match = line.match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    const command = match[3];
    if (pid === self) continue;
    if (ppid !== 1) continue;                       // parented to a live host → in use, leave it
    if (!/\bnode\b/.test(command) || !/scripts\/start-mcp(-claude)?\.mjs/.test(command)) continue;
    if (processCwd(pid) !== cwd) continue;          // different workspace → not ours to kill
    try { process.kill(pid, "SIGKILL"); console.error(`[weaver] reaped orphaned MCP process ${pid}`); }
    catch { /* already gone */ }
  }
}
