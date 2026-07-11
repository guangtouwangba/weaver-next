import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createWeaverServer } from "./create-server.js";
import { createShutdown } from "./shutdown.js";
import { log } from "./logger.js";

// Record why the process dies. A crash here is what surfaces to a host as an
// opaque "MCP proxy request failed": now every death leaves a log line first.
// EPIPE on stdio means the host closed our pipes (it exited) — exit instead of
// logging forever: these handlers once looped on the async stderr EPIPE and wrote
// a 36 GB log file (the logger now also swallows stderr errors itself).
const isStdioGone = (error: unknown) => error instanceof Error && (error as NodeJS.ErrnoException).code === "EPIPE";
process.on("uncaughtException", (error) => {
  log("error", "process.uncaughtException", { message: error.message, stack: error.stack });
  if (isStdioGone(error)) process.exit(0);
});
process.on("unhandledRejection", (reason) => {
  log("error", "process.unhandledRejection", { reason: reason instanceof Error ? reason.message : String(reason), stack: reason instanceof Error ? reason.stack : undefined });
  if (isStdioGone(reason)) process.exit(0);
});

const { server, eventHub } = await createWeaverServer();

const transport = new StdioServerTransport();
const shutdown = createShutdown(server, eventHub);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { log("info", "process.signal", { signal }); void shutdown(); });
await server.connect(transport);
log("info", "transport.connected", { transport: "stdio" });
// EXIT when the host is gone — don't linger. The SDK's StdioServerTransport never
// watches stdin for EOF (its onclose only fires on a programmatic close()), so a
// dying host (Codex/Claude exit, restart, plugin reinstall) left this process alive
// forever: a follower's rebind timer or the leader's bound HTTP server keeps the
// event loop non-empty. That is exactly how orphaned `start-mcp` processes piled up
// after every host restart. stdin EOF is the one reliable host-death signal — the
// host holds our stdin's write end, so its death closes the pipe. Self-termination
// here is the safe replacement for the external reaper (which could not tell live
// transports from dead ones and caused -32000 by killing still-proxied processes).
const hostGone = (reason: string) => () => { log("warn", "transport.hostGone", { reason }); void shutdown(); };
process.stdin.once("end", hostGone("stdin-eof"));
process.stdin.once("close", hostGone("stdin-closed"));
// stdout carries the JSON-RPC protocol; its reader disappearing (async EPIPE) is
// the same host-death signal as stdin EOF. The listener also stops the error from
// surfacing as an uncaughtException.
process.stdout.on("error", hostGone("stdout-epipe"));
const closeTransport = transport.onclose;
transport.onclose = () => { log("warn", "transport.closed", { transport: "stdio" }); closeTransport?.(); void shutdown(); };
