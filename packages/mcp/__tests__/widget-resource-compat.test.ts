import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createWeaverServer } from "../src/create-server.js";

const clients: Client[] = [];
const servers: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("Widget resource compatibility", () => {
  it("serves the legacy stable URI cached by an existing Codex task", async () => {
    const runtime = await createWeaverServer();
    servers.push(runtime);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await runtime.server.connect(serverTransport);
    const client = new Client({ name: "widget-resource-compat", version: "1.0.0" });
    clients.push(client);
    await client.connect(clientTransport);

    const resource = await client.readResource({ uri: "ui://widget/weaver/workspace.html" });

    expect(resource.contents).toHaveLength(1);
    expect(resource.contents[0]?.uri).toBe("ui://widget/weaver/workspace.html");
    expect(resource.contents[0]?.mimeType).toContain("text/html");
    expect(resource.contents[0]?.text).toContain("window.__weaverEmbeddedBuildId");
  });
});
