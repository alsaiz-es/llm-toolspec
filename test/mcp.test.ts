import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ToolSpec } from "../src/sdk/loader.js";
import { createMcpServer, installToClaudeDesktop } from "../src/generators/mcp.js";

const EXAMPLE = "spec/examples/musicbrainz.toolspec.json";

async function setupServer() {
  const spec = await ToolSpec.fromFile(EXAMPLE);
  const server = createMcpServer(spec.descriptor);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { client, server, spec };
}

describe("MCP proxy generator", () => {
  it("lists all MusicBrainz tools", async () => {
    const { client, server } = await setupServer();

    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(30);

    const names = tools.map((t) => t.name);
    expect(names).toContain("search_artists");
    expect(names).toContain("lookup_artist");
    expect(names).toContain("lookup_release");
    expect(names).toContain("browse_release_groups");
    expect(names).toContain("browse_releases");

    await server.close();
  });

  it("includes descriptions with when_to_use guidance", async () => {
    const { client, server } = await setupServer();

    const { tools } = await client.listTools();
    const searchArtists = tools.find((t) => t.name === "search_artists")!;

    expect(searchArtists.description).toContain("artist");
    expect(searchArtists.description).toContain("When to use:");

    await server.close();
  });

  it("exposes input schemas for tools", async () => {
    const { client, server } = await setupServer();

    const { tools } = await client.listTools();
    const searchArtists = tools.find((t) => t.name === "search_artists")!;

    expect(searchArtists.inputSchema).toBeDefined();
    expect(searchArtists.inputSchema.type).toBe("object");
    expect(searchArtists.inputSchema.properties).toHaveProperty("query");

    await server.close();
  });

  it("proxies search_artists to the live API", async () => {
    const { client, server } = await setupServer();

    const result = await client.callTool({
      name: "search_artists",
      arguments: { query: "radiohead", fmt: "json", limit: 1 },
    });

    expect(result.isError).not.toBe(true);
    expect(result.content).toHaveLength(1);

    const content = result.content[0] as { type: string; text: string };
    expect(content.type).toBe("text");
    expect(() => JSON.parse(content.text)).not.toThrow();

    await server.close();
  });

  it("returns error for non-existent tool", async () => {
    const { client, server } = await setupServer();

    const result = await client.callTool({
      name: "nonexistent_tool",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    const content = result.content[0] as { type: string; text: string };
    expect(content.text).toContain("Tool not found");

    await server.close();
  });

  it("proxies lookup_artist with path parameter {mbid}", async () => {
    const { client, server } = await setupServer();

    const result = await client.callTool({
      name: "lookup_artist",
      arguments: { mbid: "a74b1b7f-71a5-4011-9441-d0b5e4122711", fmt: "json" },
    });

    expect(result.content).toHaveLength(1);
    const content = result.content[0] as { type: string; text: string };
    expect(content.type).toBe("text");

    const data = JSON.parse(content.text);
    expect(data.name).toBe("Radiohead");

    await server.close();
  });

  it("sets server name from descriptor", async () => {
    const spec = await ToolSpec.fromFile(EXAMPLE);
    const server = createMcpServer(spec.descriptor);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const info = client.getServerVersion();
    expect(info?.name).toBe("toolspec-MusicBrainz");
    expect(info?.version).toBe("2.0.0");

    await server.close();
  });
});

describe("installToClaudeDesktop", () => {
  const tempConfig = () =>
    join(tmpdir(), `toolspec-test-${Date.now()}`, "claude_desktop_config.json");

  it("creates config file when it does not exist", async () => {
    const configPath = tempConfig();
    const spec = await ToolSpec.fromFile(EXAMPLE);

    const result = await installToClaudeDesktop(EXAMPLE, spec.descriptor, configPath);

    expect(result.created).toBe(true);
    expect(result.serverName).toBe("toolspec-musicbrainz");
    expect(result.configPath).toBe(configPath);

    const raw = JSON.parse(await readFile(configPath, "utf-8"));
    expect(raw.mcpServers["toolspec-musicbrainz"]).toBeDefined();
    expect(raw.mcpServers["toolspec-musicbrainz"].command).toBe("node");
    expect(raw.mcpServers["toolspec-musicbrainz"].args).toContain("connect");

    const sourcePath = raw.mcpServers["toolspec-musicbrainz"].args.at(-1) as string;
    expect(sourcePath).toMatch(/\/.*musicbrainz\.toolspec\.json$/);

    await rm(join(configPath, ".."), { recursive: true });
  });

  it("preserves existing config: top-level keys, other servers, and their settings", async () => {
    const configPath = tempConfig();
    const spec = await ToolSpec.fromFile(EXAMPLE);

    const { writeFile: wf, mkdir: mkdirFs } = await import("node:fs/promises");
    await mkdirFs(join(configPath, ".."), { recursive: true });
    const originalConfig = {
      globalShortcut: "Ctrl+Space",
      theme: "dark",
      mcpServers: {
        "my-existing-server": {
          command: "node",
          args: ["server.js"],
          env: { API_KEY: "secret-123" },
        },
      },
    };
    await wf(configPath, JSON.stringify(originalConfig), "utf-8");

    const result = await installToClaudeDesktop(EXAMPLE, spec.descriptor, configPath);

    expect(result.created).toBe(false);

    const updated = JSON.parse(await readFile(configPath, "utf-8"));

    expect(updated.globalShortcut).toBe("Ctrl+Space");
    expect(updated.theme).toBe("dark");
    expect(updated.mcpServers["my-existing-server"].command).toBe("node");
    expect(updated.mcpServers["my-existing-server"].env.API_KEY).toBe("secret-123");
    expect(updated.mcpServers["toolspec-musicbrainz"]).toBeDefined();

    expect(result.backupPath).toBe(configPath.replace(/\.json$/, ".backup.json"));
    const backup = JSON.parse(await readFile(result.backupPath!, "utf-8"));
    expect(backup).toEqual(originalConfig);

    await rm(join(configPath, ".."), { recursive: true });
  });

  it("does not create backup when config file is new", async () => {
    const configPath = tempConfig();
    const spec = await ToolSpec.fromFile(EXAMPLE);

    const result = await installToClaudeDesktop(EXAMPLE, spec.descriptor, configPath);

    expect(result.created).toBe(true);
    expect(result.backupPath).toBeUndefined();

    await rm(join(configPath, ".."), { recursive: true });
  });

  it("generates correct server name from service name", async () => {
    const configPath = tempConfig();
    const spec = await ToolSpec.fromFile(EXAMPLE);

    const result = await installToClaudeDesktop("https://example.com", spec.descriptor, configPath);

    expect(result.serverName).toBe("toolspec-musicbrainz");

    await rm(join(configPath, ".."), { recursive: true });
  });
});
