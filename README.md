# Open LLM Tool Specification (ToolSpec)

**A vendor-agnostic standard for describing, discovering, and consuming LLM tool services over HTTP.**

## The problem

LLMs can call external tools — but the ecosystem for publishing and consuming those tools is fragmented and stuck in a local-first model that doesn't scale.

| | MCP | OpenAPI | Function Calling |
|---|---|---|---|
| Designed for LLMs | ✓ | ✗ | ✓ |
| Remote-native (no local component) | ✗ | ✓ | ✗ |
| Vendor-agnostic | Partial | ✓ | ✗ |
| Domain knowledge layer | ✗ | ✗ | ✗ |
| Auto-discovery | Partial | ✗ | ✗ |
| Workflow examples | ✗ | ✗ | ✗ |

**MCP** requires a local server process — fine for dev tools, unworkable for publishing services at scale. Every consumer runs your code locally, exposing your IP and requiring per-user setup.

**OpenAPI** is remote-native but was designed for human developers, not LLMs. It lacks semantic guidance (when to call a tool, how to chain calls, what results mean) and has no concept of domain knowledge.

**Function Calling** varies by provider (OpenAI, Anthropic, Google all use different schemas) with no portability.

None of them answer the real question: **how does an LLM reason *with* a set of tools, not just call them?**

## The proposal

ToolSpec is a JSON descriptor published at a well-known URL that tells any LLM everything it needs to discover, understand, and consume a remote tool service. No local installation. No vendor lock-in. Pure HTTP.

```
GET https://api.example.com/.well-known/toolspec.json
```

The descriptor has three layers:

### Layer 1 — Service (how to connect)

Authentication, rate limits, streaming support, session management, base URL. Everything an HTTP client needs to establish a connection.

```json
{
  "base_url": "https://musicbrainz.org/ws/2",
  "auth": {
    "required": false,
    "schemes": [{ "type": "none", "description": "No auth for read-only requests. User-Agent header is mandatory." }]
  },
  "capabilities": {
    "streaming": false,
    "async_tasks": false,
    "rate_limit": { "requests_per_minute": 50 }
  }
}
```

### Layer 2 — Tools (what to call)

Each tool maps to an HTTP endpoint with typed parameters and responses. Like OpenAPI, but enriched with LLM-specific metadata: `when_to_use` (natural language guidance for tool selection), `estimated_duration`, error semantics, and streaming options.

```json
{
  "name": "search_artists",
  "description": "Searches the artist index using Lucene query syntax. Fields: alias, artist, country, tag, type, etc.",
  "when_to_use": "When finding an artist by name, country, type, or tag. Use to resolve names to MBIDs.",
  "endpoint": { "method": "GET", "path": "/artist" },
  "parameters": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "Lucene query. Ex: 'radiohead', 'artist:bjork AND type:person'." },
      "fmt": { "type": "string", "enum": ["json"] },
      "limit": { "type": "integer", "default": 25 },
      "offset": { "type": "integer", "default": 0 }
    },
    "required": ["query", "fmt"]
  },
  "estimated_duration_seconds": 3,
  "idempotent": true
}
```

### Layer 3 — Knowledge (how to reason)

The layer that doesn't exist anywhere else. Domain expertise encoded as workflows, interpretation guides, and glossaries. This turns a bag of tools into a *skill*.

```json
{
  "knowledge": {
    "domain": "Music metadata (MusicBrainz)",
    "system_context": "MusicBrainz has a strict entity hierarchy: Artist → Release Group → Release → Medium → Track → Recording. Lookup inc= caps at 25 linked entities — always use browse for complete lists.",
    "workflows": [
      {
        "name": "artist_discography",
        "trigger": "When a user asks for an artist's albums, discography, or complete releases.",
        "steps": [
          "search_artists to resolve name to MBID",
          "browse_release_groups with artist= and type=album for full discography",
          "browse_releases with release-group= for all editions of an album",
          "lookup_release with inc=recordings+artist-credits for tracklist"
        ],
        "interpretation": "Release groups are album concepts; releases are specific editions. Always browse release-groups first."
      }
    ],
    "glossary": {
      "MBID": "MusicBrainz Identifier — UUID uniquely identifying any entity.",
      "Release Group": "Abstract grouping of releases (the 'album concept').",
      "Recording": "Unique audio entity. Same recording across many tracks/releases."
    }
  }
}
```

## Quick start

```bash
# Install
npm install toolspec

# Validate a descriptor
npx toolspec validate musicbrainz.toolspec.json

# Start MCP server that proxies to the remote API
npx toolspec connect musicbrainz.toolspec.json

# Install as Claude Desktop MCP server
npx toolspec install musicbrainz.toolspec.json

# Inspect translated tool definitions
npx toolspec inspect musicbrainz.toolspec.json --provider anthropic
```

## How it works

```text
  PROVIDER                         CONSUMER (any LLM client)
  ────────                         ──────────────────────────

  ┌─────────────────┐   HTTPS GET   ┌─────────────────────┐
  │  Your service    │◄──────────────│  LLM Client SDK     │
  │  (runs on your   │  /.well-known │  (Python/TS/etc)    │
  │   infra)         │  /toolspec.json│                     │
  │                  ├──────────────►│  1. Fetch descriptor │
  │  ┌────────────┐  │               │  2. Translate to     │
  │  │ Your logic │  │   HTTPS POST  │     native tool defs │
  │  │ Your data  │  │◄──────────────│     (OpenAI/Claude/  │
  │  │ Your IP    │  │               │      Gemini/etc)     │
  │  └────────────┘  │  Tool results │  3. Inject knowledge │
  │                  ├──────────────►│     as context        │
  └─────────────────┘               │  4. Execute via HTTP  │
                                    └─────────────────────┘
                                              │
                                              ▼
                                    ┌─────────────────────┐
                                    │  Any LLM             │
                                    │  (Claude, GPT,       │
                                    │   Gemini, Llama...) │
                                    └─────────────────────┘
```

**Provider side:** Publish a `toolspec.json` at a well-known URL. Your logic runs on your infrastructure. Your IP stays protected. No code distribution.

**Consumer side:** A lightweight SDK fetches the descriptor, translates Layer 2 (tools) into the native function calling format of whatever LLM you're using, injects Layer 3 (knowledge) as system prompt context, and routes tool calls as HTTP requests to the provider's endpoints.

## Demo: MusicBrainz

The [MusicBrainz demo](demos/musicbrainz-mcp.md) shows a complete end-to-end flow with 46 tools running as an MCP proxy in Claude Desktop:

```
search_artists("radiohead")
  → browse_release_groups(artist: "a74b1b7f...")  → 382 albums
    → browse_releases(release-group: "b1392450...")  → 38 editions of OK Computer
      → lookup_release(mbid: "c7569949...", inc: "recordings")  → 12-track tracklist
        → lookup_recording(mbid: "...", inc: "tags+genres")  → Paranoid Android, 6:24
```

All through an MCP proxy with zero MusicBrainz-specific logic — just HTTP calls routed by the `toolspec.json` descriptor.

## Key design decisions

**Remote-first, not remote-capable.** MCP bolted remote support onto a local-first design. ToolSpec assumes HTTP from day one. No stdio, no JSON-RPC, no local process.

**The descriptor is the product.** Providers don't distribute code — they publish a URL. Consumers don't install anything — they fetch a JSON file. This is how APIs work. It's how LLM tools should work.

**Knowledge is a first-class layer.** The gap between "here are 46 endpoints" and "here's how to navigate from an artist to a tracklist" is where all the value lives. ToolSpec makes that explicit and portable.

**Vendor-agnostic by construction.** The spec doesn't reference any provider's format. The SDK handles translation. Write one descriptor, consumed by any LLM.

## Comparison

| Feature | ToolSpec | MCP | OpenAPI | ChatGPT Plugins (dead) |
|---|---|---|---|---|
| Remote-native | ✓ | Partial | ✓ | ✓ |
| LLM-aware semantics | ✓ | ✓ | ✗ | Partial |
| Domain knowledge layer | ✓ | ✗ | ✗ | ✗ |
| Workflow examples | ✓ | ✗ | ✗ | ✗ |
| Vendor-agnostic | ✓ | Partial | ✓ | ✗ (OpenAI only) |
| IP protection | ✓ (remote) | ✗ (local) | ✓ (remote) | ✓ (remote) |
| Auto-discovery | ✓ (.well-known) | Partial | ✗ | ✓ (ai-plugin.json) |
| State management | ✓ (server-side) | ✗ | ✗ | ✗ |
| Streaming | ✓ | ✓ | ✗ | ✗ |

## Related

- [toolspec-generator](https://github.com/alsaiz-es/toolspec-generator) — Claude Desktop skill that generates ToolSpec descriptors from API documentation

## Roadmap

- [x] **v0.1 Spec** — JSON Schema for the three-layer descriptor
- [x] **Reference SDK** — TypeScript SDK with translator (OpenAI/Anthropic), executor, and MCP proxy generator
- [x] **Example service** — MusicBrainz API (46 tools, full entity hierarchy, knowledge layer)
- [x] **CLI** — `validate`, `connect`, `install`, `inspect` commands
- [ ] **Python SDK** — Reference implementation in Python
- [ ] **Registry** — Directory of published ToolSpec services

## Contributing

This is an open specification. We welcome contributions to the spec, SDKs, and tooling.

## License

Apache 2.0
