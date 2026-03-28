import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import type { ToolSpecDescriptor } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let ajvValidate: ReturnType<Ajv["compile"]> | null = null;

async function getValidator(): Promise<ReturnType<Ajv["compile"]>> {
  if (ajvValidate) return ajvValidate;

  const schemaPath = join(__dirname, "../../spec/schema/toolspec-schema-v0.1.json");
  const schemaContent = await readFile(schemaPath, "utf-8");
  const schema = JSON.parse(schemaContent);

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  ajvValidate = ajv.compile(schema);
  return ajvValidate;
}

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
    return new ToolSpec(await validate(data));
  }

  /**
   * Load a ToolSpec from a local file path.
   */
  static async fromFile(path: string): Promise<ToolSpec> {
    const content = await readFile(path, "utf-8");
    const data = JSON.parse(content) as ToolSpecDescriptor;
    return new ToolSpec(await validate(data));
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
 * Validate a descriptor against the ToolSpec JSON Schema using Ajv.
 */
async function validate(data: ToolSpecDescriptor): Promise<ToolSpecDescriptor> {
  const validator = await getValidator();
  const valid = validator(data);

  if (!valid && validator.errors) {
    const messages = validator.errors.map((e) => {
      const path = e.instancePath || "(root)";
      return `  ${path}: ${e.message}`;
    });
    throw new Error(`Invalid ToolSpec descriptor:\n${messages.join("\n")}`);
  }

  return data;
}
