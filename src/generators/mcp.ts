import { readFile, writeFile, copyFile, mkdir } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { ToolSpecDescriptor, Tool } from "../sdk/types.js";
import { execute } from "../sdk/executor.js";
import type { ExecuteOptions } from "../sdk/executor.js";

/**
 * Build a combined MCP tool description from a ToolSpec tool definition.
 * Includes when_to_use guidance if present.
 */
function buildMcpDescription(tool: Tool): string {
  let desc = tool.description;
  if (tool.when_to_use) {
    desc += `\n\nWhen to use: ${tool.when_to_use}`;
  }
  return desc;
}

/**
 * Build MCP server instructions from the ToolSpec knowledge layer.
 */
function buildInstructions(descriptor: ToolSpecDescriptor): string | undefined {
  const knowledge = descriptor.knowledge;
  if (!knowledge) return undefined;

  const parts: string[] = [];

  if (knowledge.domain) {
    parts.push(`Domain: ${knowledge.domain}`);
  }
  if (knowledge.system_context) {
    parts.push(knowledge.system_context);
  }
  if (knowledge.workflows?.length) {
    parts.push("Workflows:");
    for (const wf of knowledge.workflows) {
      parts.push(`  ${wf.name} (trigger: ${wf.trigger})`);
      for (const step of wf.steps) {
        parts.push(`    - ${step}`);
      }
      if (wf.interpretation) {
        parts.push(`    Note: ${wf.interpretation}`);
      }
    }
  }
  if (knowledge.glossary && Object.keys(knowledge.glossary).length > 0) {
    parts.push("Glossary:");
    for (const [term, definition] of Object.entries(knowledge.glossary)) {
      parts.push(`  ${term}: ${definition}`);
    }
  }

  return parts.length > 0 ? parts.join("\n") : undefined;
}

/**
 * Create an MCP Server instance from a ToolSpec descriptor.
 * Uses the low-level Server API so we can pass JSON Schema directly
 * without requiring Zod.
 *
 * Each ToolSpec tool is registered as an MCP tool that proxies
 * execution to the remote service via HTTP.
 */
export function createMcpServer(
  descriptor: ToolSpecDescriptor,
  options: ExecuteOptions = {}
): Server {
  const server = new Server(
    {
      name: `toolspec-${descriptor.service.name}`,
      version: descriptor.service.version,
    },
    {
      capabilities: { tools: {} },
      instructions: buildInstructions(descriptor),
    }
  );

  // List all ToolSpec tools as MCP tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: descriptor.tools.map((tool) => ({
      name: tool.name,
      description: buildMcpDescription(tool),
      inputSchema: tool.parameters ?? { type: "object" as const, properties: {} },
    })),
  }));

  // Proxy tool calls to the remote service
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const result = await execute(
        descriptor,
        name,
        (args as Record<string, unknown>) ?? {},
        options
      );

      if (result.status >= 200 && result.status < 300) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result.data, null, 2),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { error: true, status: result.status, data: result.data },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Request failed: ${(err as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

/**
 * Start an MCP server on stdio that proxies ToolSpec tools to the remote service.
 * This is the main entry point for `toolspec connect <url>`.
 */
export async function startMcpServer(
  descriptor: ToolSpecDescriptor,
  options: ExecuteOptions = {}
): Promise<void> {
  const server = createMcpServer(descriptor, options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/**
 * Returns the path to Claude Desktop's config file based on the current OS.
 */
export function getClaudeDesktopConfigPath(): string {
  if (platform() === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  }
  return join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
}

export interface InstallResult {
  configPath: string;
  serverName: string;
  created: boolean;
  backupPath?: string;
}

/**
 * Install a ToolSpec as an MCP server entry in Claude Desktop's config.
 *
 * Reads the existing config (or creates one), adds/updates an mcpServers entry
 * that runs `npx toolspec connect <source>`, and writes it back.
 */
export async function installToClaudeDesktop(
  source: string,
  descriptor: ToolSpecDescriptor,
  configPath?: string
): Promise<InstallResult> {
  const resolvedPath = configPath ?? getClaudeDesktopConfigPath();

  // Read existing config or start fresh
  let config: Record<string, unknown>;
  let created = false;
  let backupPath: string | undefined;
  try {
    const raw = await readFile(resolvedPath, "utf-8");
    config = JSON.parse(raw) as Record<string, unknown>;

    // Backup before modifying
    backupPath = resolvedPath.replace(/\.json$/, ".backup.json");
    await copyFile(resolvedPath, backupPath);
  } catch {
    config = {};
    created = true;
  }

  if (!config.mcpServers || typeof config.mcpServers !== "object") {
    config.mcpServers = {};
  }

  const servers = config.mcpServers as Record<string, unknown>;
  const serverName = `toolspec-${descriptor.service.name.toLowerCase().replace(/\s+/g, "-")}`;

  // Build the command that Claude Desktop will run
  // Use the absolute path to this CLI so it works from any cwd
  const resolvedSource = source.startsWith("http") ? source : resolve(source);

  servers[serverName] = {
    command: "npx",
    args: ["toolspec", "connect", resolvedSource],
  };

  // Ensure the parent directory exists
  await mkdir(join(resolvedPath, ".."), { recursive: true });
  await writeFile(resolvedPath, JSON.stringify(config, null, 2) + "\n", "utf-8");

  return { configPath: resolvedPath, serverName, created, backupPath };
}
