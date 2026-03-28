# CLAUDE.md

## Project overview

**Open LLM Tool Specification (ToolSpec)** — a vendor-agnostic standard for describing, discovering, and consuming LLM tool services over HTTP. Think "OpenAPI for LLM tools" but with three layers: Service (how to connect), Tools (what to call), and Knowledge (how to reason).

## Architecture

```
toolspec.json (published by provider at /.well-known/toolspec.json)
       │
       ▼
  ToolSpec SDK/CLI ("compiler")
       │
       ├──► MCP server (auto-generated proxy, zero local logic, HTTP calls to remote)
       ├──► Native tool defs (OpenAI / Anthropic / Google format)
       └──► System prompt (optional Layer 3 knowledge injection)
```

The core value proposition: providers publish a JSON descriptor at a well-known URL. Consumers run `npx toolspec connect <url>` and get a working MCP server that proxies tool calls to the remote service. No local code execution, no IP exposure.

## Project structure

```
spec/
  schema/toolspec-schema-v0.1.json   # Formal JSON Schema for the spec
  examples/musicbrainz.toolspec.json # Reference example (MusicBrainz API)
src/
  cli/index.ts                       # CLI entry point (toolspec validate|connect)
  sdk/
    index.ts                         # SDK public API
    loader.ts                        # Fetch and validate toolspec.json from URL
    translator.ts                    # Convert ToolSpec tools → provider-native formats
    executor.ts                      # Execute tool calls as HTTP requests
  generators/
    mcp.ts                           # Generate MCP server config/proxy from ToolSpec
test/
docs/
```

## Key design decisions

- **TypeScript + ESM** — MCP ecosystem is Node/TS, so we match it
- **Remote-first** — no stdio, no local process model. Everything is HTTP
- **The descriptor is the product** — providers publish a URL, consumers fetch a JSON
- **MCP proxy generator is the MVP** — `npx toolspec connect <url>` generates a working MCP server
- **Vendor-agnostic** — spec doesn't reference any LLM provider's format. SDK translates

## Development priorities (in order)

1. **Schema validation** — `toolspec validate <file|url>` validates a descriptor against the JSON Schema
2. **SDK loader** — fetch a remote toolspec.json, validate, return typed object
3. **Translator** — convert ToolSpec tools to Anthropic and OpenAI function calling formats
4. **Executor** — take a tool name + input from the LLM, build the HTTP request, execute, return result
5. **MCP generator** — generate a minimal MCP server that uses loader + executor to proxy remote tools
6. **`connect` command** — `toolspec connect <url>` fetches descriptor and generates MCP server config

## Tech notes

- The MusicBrainz example uses https://musicbrainz.org/ws/2 as the live API (rate limit: 1 req/sec, User-Agent required)
- Path parameters like `/artist/{mbid}` must be extracted from tool input and interpolated into the URL
- GET requests: parameters go as query string. POST/PUT/PATCH: parameters go as JSON body
- `when_to_use` field is LLM-specific guidance — maps to the MCP tool description
- `estimated_duration_seconds` can hint sync vs async execution strategy
- The `knowledge` layer is optional in v0.1 — focus on tools first

## Commands

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript
npm run dev          # Watch mode
npm run test         # Run tests with vitest
npx tsx src/cli/index.ts validate spec/examples/musicbrainz.toolspec.json  # Validate example
npx tsx src/cli/index.ts connect https://example.com                    # Generate MCP proxy
```

## Code style

- Prefer explicit types over inference for public APIs
- Use `fetch` (native Node 20+) for HTTP — no axios
- Error messages should be actionable ("Expected field 'name' in tool at index 2" not "validation failed")
- Keep the SDK usable standalone (no CLI dependency). CLI imports from SDK, not the other way around
