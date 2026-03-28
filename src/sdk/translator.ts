import type { ToolSpecDescriptor, Tool } from "./types.js";

export type Provider = "anthropic" | "openai";

/**
 * Translate ToolSpec tools into provider-native function calling format.
 */
export function translate(descriptor: ToolSpecDescriptor, provider: Provider): unknown[] {
  switch (provider) {
    case "anthropic":
      return descriptor.tools.map(toAnthropicTool);
    case "openai":
      return descriptor.tools.map(toOpenAITool);
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

function toAnthropicTool(tool: Tool) {
  return {
    name: tool.name,
    description: buildDescription(tool),
    input_schema: tool.parameters ?? { type: "object" as const, properties: {} },
  };
}

function toOpenAITool(tool: Tool) {
  return {
    type: "function" as const,
    function: {
      name: tool.name,
      description: buildDescription(tool),
      parameters: tool.parameters ?? { type: "object" as const, properties: {} },
    },
  };
}

/**
 * Build a rich description combining description + when_to_use.
 * This is the key LLM-facing text that helps tool selection.
 */
function buildDescription(tool: Tool): string {
  const parts = [tool.description];
  if (tool.when_to_use) {
    parts.push(`When to use: ${tool.when_to_use}`);
  }
  return parts.join("\n\n");
}
