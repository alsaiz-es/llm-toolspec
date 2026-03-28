#!/usr/bin/env node

import { Command } from "commander";
import { ToolSpec } from "../sdk/loader.js";
import { translate } from "../sdk/translator.js";
import { startMcpServer, installToClaudeDesktop } from "../generators/mcp.js";

const program = new Command();

program
  .name("toolspec")
  .description("Open LLM Tool Specification CLI")
  .version("0.1.0");

program
  .command("validate")
  .description("Validate a ToolSpec descriptor file or URL")
  .argument("<source>", "Path to a .toolspec.json file or a URL")
  .action(async (source: string) => {
    try {
      const spec = source.startsWith("http")
        ? await ToolSpec.fromUrl(source)
        : await ToolSpec.fromFile(source);

      console.log(`✓ Valid ToolSpec: ${spec.name}`);
      console.log(`  Version: ${spec.descriptor.service.version}`);
      console.log(`  Tools (${spec.toolNames.length}): ${spec.toolNames.join(", ")}`);
      console.log(`  Base URL: ${spec.descriptor.base_url}`);
    } catch (err) {
      console.error(`✗ Validation failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command("connect")
  .description("Generate an MCP server proxy from a remote ToolSpec")
  .argument("<url>", "URL of the ToolSpec descriptor or base domain")
  .option("--output <dir>", "Output directory", ".")
  .option("--provider <name>", "LLM provider format (anthropic|openai)", "anthropic")
  .action(async (url: string) => {
    try {
      const spec = url.startsWith("http")
        ? await ToolSpec.fromUrl(url)
        : await ToolSpec.fromFile(url);

      console.error(`✓ Connected: ${spec.name} (${spec.toolNames.length} tools)`);
      console.error(`  Tools: ${spec.toolNames.join(", ")}`);
      console.error(`  Base URL: ${spec.descriptor.base_url}`);

      await startMcpServer(spec.descriptor);
    } catch (err) {
      console.error(`✗ Failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command("install")
  .description("Install a ToolSpec as an MCP server in Claude Desktop")
  .argument("<source>", "Path to a .toolspec.json file or a URL")
  .option("--config <path>", "Custom path to claude_desktop_config.json")
  .action(async (source: string, options: { config?: string }) => {
    try {
      const spec = source.startsWith("http")
        ? await ToolSpec.fromUrl(source)
        : await ToolSpec.fromFile(source);

      const result = await installToClaudeDesktop(source, spec.descriptor, options.config);

      console.log(`✓ Installed "${result.serverName}" in Claude Desktop`);
      console.log(`  Config: ${result.configPath}${result.created ? " (created)" : ""}`);
      if (result.backupPath) {
        console.log(`  Backup: ${result.backupPath}`);
      }
      console.log(`  Tools (${spec.toolNames.length}): ${spec.toolNames.join(", ")}`);
      console.log(`\n  Restart Claude Desktop to activate the new MCP server.`);
    } catch (err) {
      console.error(`✗ Install failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command("inspect")
  .description("Show translated tool definitions for a specific provider")
  .argument("<source>", "Path to a .toolspec.json file or a URL")
  .option("--provider <name>", "LLM provider (anthropic|openai)", "anthropic")
  .action(async (source: string, options: { provider: string }) => {
    try {
      const spec = source.startsWith("http")
        ? await ToolSpec.fromUrl(source)
        : await ToolSpec.fromFile(source);

      const tools = translate(spec.descriptor, options.provider as "anthropic" | "openai");
      console.log(JSON.stringify(tools, null, 2));
    } catch (err) {
      console.error(`✗ Failed: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program.parse();
