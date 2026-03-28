import { readFile } from "node:fs/promises";
import type { ToolSpecDescriptor } from "./types.js";

/**
 * Main entry point for loading a ToolSpec descriptor.
 * Fetches from a URL or reads from a local file, validates against the schema,
 * and returns a typed descriptor object.
 */
export class ToolSpec {
  readonly descriptor: ToolSpecDescriptor;

  private constructor(descriptor: ToolSpecDescriptor) {
    this.descriptor = descriptor;
  }

  /**
   * Load a ToolSpec from a remote URL.
   * Fetches /.well-known/toolspec.json if a bare domain is provided.
   */
  static async fromUrl(url: string): Promise<ToolSpec> {
    const resolvedUrl = url.endsWith(".json")
      ? url
      : `${url.replace(/\/+$/, "")}/.well-known/toolspec.json`;

    const response = await fetch(resolvedUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch ToolSpec from ${resolvedUrl}: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as ToolSpecDescriptor;
    return new ToolSpec(validate(data));
  }

  /**
   * Load a ToolSpec from a local file path.
   */
  static async fromFile(path: string): Promise<ToolSpec> {
    const content = await readFile(path, "utf-8");
    const data = JSON.parse(content) as ToolSpecDescriptor;
    return new ToolSpec(validate(data));
  }

  /** Service name */
  get name(): string {
    return this.descriptor.service.name;
  }

  /** List of tool names */
  get toolNames(): string[] {
    return this.descriptor.tools.map((t) => t.name);
  }
}

/**
 * Validate a descriptor against the ToolSpec JSON Schema.
 * TODO: Implement with Ajv
 */
function validate(data: ToolSpecDescriptor): ToolSpecDescriptor {
  if (data.toolspec !== "0.1") {
    throw new Error(`Unsupported ToolSpec version: ${data.toolspec}`);
  }
  if (!data.service?.name) {
    throw new Error("Missing required field: service.name");
  }
  if (!data.base_url) {
    throw new Error("Missing required field: base_url");
  }
  if (!data.tools?.length) {
    throw new Error("ToolSpec must define at least one tool");
  }
  return data;
}
