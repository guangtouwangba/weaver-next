import { createConnection } from "node:net";
import { runtimeControlRequestSchema, type RuntimeControlRequest } from "@weaver/contracts";

export function sendRuntimeControl(socketPath: string, request: RuntimeControlRequest) {
  const validated = runtimeControlRequestSchema.parse(request);
  return new Promise<unknown>((resolve, reject) => {
    const socket = createConnection(socketPath);
    let data = "";
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${JSON.stringify(validated)}\n`));
    socket.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_048_576) { socket.destroy(); reject(new Error("CONTROL_RESPONSE_TOO_LARGE")); }
    });
    socket.on("error", reject);
    socket.on("end", () => {
      try {
        const response = JSON.parse(data) as { ok: boolean; result?: unknown; error?: { code?: string } };
        if (!response.ok) reject(new Error(response.error?.code ?? "CONTROL_REQUEST_FAILED"));
        else resolve(response.result);
      } catch (error) { reject(error); }
    });
  });
}
