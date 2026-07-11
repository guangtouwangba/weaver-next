import { describe, expect, it } from "vitest";
import { agentHostLabel, contextStatus, isDevHost, resolveHostMode, type WeaverPreview } from "../lib/host-mode";

const preview: WeaverPreview = { host: "claude", origin: "http://127.0.0.1:5000", rpcPath: "/mcp-rpc", bootstrapPath: "/api/bootstrap", token: "tok", buildId: "b1" };

describe("host mode resolution", () => {
  it("selects the Claude host whenever the preview global is injected, even on loopback", () => {
    expect(resolveHostMode("127.0.0.1", preview)).toBe("claude");
    expect(resolveHostMode("localhost", preview)).toBe("claude");
    expect(isDevHost("127.0.0.1", preview)).toBe(false);
  });

  it("treats plain loopback without a preview global as the read-only Vite dev host", () => {
    expect(resolveHostMode("localhost", undefined)).toBe("dev");
    expect(resolveHostMode("127.0.0.1", undefined)).toBe("dev");
    expect(isDevHost("localhost", undefined)).toBe(true);
  });

  it("treats any non-loopback origin as the Codex embedded host", () => {
    expect(resolveHostMode("web.example.com", undefined)).toBe("codex");
    expect(isDevHost("web.example.com", undefined)).toBe(false);
  });
});

describe("canvas context status text", () => {
  it("never says 'Agent unavailable' under the Claude host and names the Claude session", () => {
    expect(contextStatus("claude", false, true, 0)).toBe("Bound to this Claude session");
    expect(contextStatus("claude", false, true, 2)).toBe("2 selected · bound to this Claude session");
    expect(contextStatus("claude", false, false, 0)).toBe("Canvas is not bound to this Claude session");
    expect(agentHostLabel("claude")).toBe("this Claude session");
  });

  it("keeps the read-only preview wording for the Vite dev host and demo mode", () => {
    expect(contextStatus("dev", false, true, 3)).toBe("Browser preview. Agent unavailable");
    expect(contextStatus("codex", true, true, 0)).toBe("Browser preview. Agent unavailable");
  });

  it("keeps Codex wording for the embedded host", () => {
    expect(contextStatus("codex", false, true, 0)).toBe("Bound to this Codex chat");
    expect(contextStatus("codex", false, false, 0)).toBe("Canvas is not bound to this Codex chat");
  });
});
