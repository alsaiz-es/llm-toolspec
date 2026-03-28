# ToolSpec

**A semantic manifest for remote APIs consumed by LLMs.**

ToolSpec complements OpenAPI and MCP instead of replacing them. OpenAPI describes endpoints; MCP exposes runtime tools; ToolSpec adds the metadata LLMs need to **choose the right tool** and **chain multi-step calls**: `when_to_use` guidance, workflow examples, and an optional domain knowledge layer.

Use it when a remote API is technically callable but models still struggle to select the right endpoint or sequence calls correctly.

## What it looks like

### `when_to_use` — tool selection guidance

```json
{
  "name": "search_artists",
  "description": "Searches the artist index using Lucene query syntax.",
  "when_to_use": "When finding an artist by name, country, type, or tag. Use to resolve names to MBIDs.",
  "endpoint": { "method": "GET", "path": "/artist" },
  "parameters": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "Lucene query. Ex: 'radiohead', 'artist:bjork AND type:person'." },
      "fmt": { "type": "string", "enum": ["json"] },
      "limit": { "type": "integer", "default": 25 }
    },
    "required": ["query", "fmt"]
  },
  "estimated_duration_seconds": 3,
  "idempotent": true
}
```

The `description` explains **what** the tool does. The `when_to_use` explains **when** to pick it. Both are needed — this is what makes LLMs choose correctly.

### Workflow examples — multi-step chaining

```json
{
  "examples": [
    {
      "description": "Full artist discography: search → albums → tracklist → recording detail",
      "steps": [
        { "tool": "search_artists", "input": { "query": "radiohead", "fmt": "json" },
          "note": "Resolve artist name to MBID." },
        { "tool": "browse_release_groups", "input": { "artist": "${step_1.artists[0].id}", "type": "album" },
          "note": "Get full album discography." },
        { "tool": "lookup_release", "input": { "mbid": "${step_2.release-groups[0].id}", "inc": "recordings" },
          "note": "Get tracklist with recording MBIDs." },
        { "tool": "lookup_recording", "input": { "mbid": "${step_3.media[0].tracks[0].recording.id}", "inc": "tags+genres" },
          "note": "Get recording details." }
      ]
    }
  ]
}
```

The `${step_N.field}` syntax teaches the LLM how to extract values from one call and feed them into the next.

### Knowledge layer — domain expertise

```json
{
  "knowledge": {
    "domain": "Music metadata (MusicBrainz)",
    "system_context": "MusicBrainz has a strict entity hierarchy: Artist → Release Group → Release → Medium → Track → Recording. Lookup inc= caps at 25 linked entities — always use browse for complete lists.",
    "workflows": [
      {
        "name": "artist_discography",
        "trigger": "When a user asks for an artist's albums or discography.",
        "steps": [
          "search_artists to resolve name to MBID",
          "browse_release_groups with artist= and type=album",
          "browse_releases with release-group= for editions",
          "lookup_release with inc=recordings for tracklist"
        ]
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

Skip the knowledge layer for simple CRUD APIs. Use it when the domain has concepts, hierarchies, or interpretation patterns the LLM wouldn't know from general training.

## Demo: MusicBrainz

We generated a ToolSpec descriptor for the [MusicBrainz API](https://musicbrainz.org/doc/MusicBrainz_API) — 46 tools covering every endpoint — and installed it as an MCP proxy in Claude Desktop.

Then we asked Claude to find the tracklist of OK Computer. It chained 5 calls autonomously:

```text
search_artists("radiohead") → found MBID
  → browse_release_groups → 382 release groups (albums, singles, EPs...)
    → browse_releases → 38 editions of OK Computer
      → lookup_release → 12 tracks
        → lookup_recording → Paranoid Android, 6:24, art rock
```

Zero MusicBrainz-specific logic in the proxy. Just HTTP calls routed by the JSON descriptor. [Full demo walkthrough](demos/musicbrainz-mcp.md).

## Quick start

```bash
# Install
npm install toolspec

# Validate a descriptor against the JSON Schema
npx toolspec validate musicbrainz.toolspec.json

# Start MCP server that proxies to the remote API
npx toolspec connect musicbrainz.toolspec.json

# Install as Claude Desktop MCP server
npx toolspec install musicbrainz.toolspec.json

# Inspect translated tool definitions
npx toolspec inspect musicbrainz.toolspec.json --provider anthropic
```

## The three layers

A ToolSpec descriptor is a JSON file with three layers:

**Layer 1 — Service**: base URL, authentication, rate limits, capabilities. Everything an HTTP client needs to connect.

**Layer 2 — Tools**: each tool maps to an endpoint with typed parameters, response schemas, `when_to_use` guidance, duration estimates, and error definitions. Like OpenAPI, but with LLM-facing semantics.

**Layer 3 — Knowledge** (optional): domain context, named workflows with triggers, interpretation guides, and glossaries. This turns a bag of tools into a coherent skill.

## Architecture

The descriptor is vendor-agnostic. The SDK translates it to whatever the consumer needs:

```text
  toolspec.json
       │
       ├──► MCP server (auto-generated proxy, routes HTTP calls to remote API)
       ├──► Native tool defs (Anthropic / OpenAI / Google format)
       └──► System prompt (knowledge layer injection)
```

Right now the primary consumer is an MCP proxy for Claude Desktop, but the same descriptor can feed OpenAI function calling, Google tools, or any other LLM client.

## Related

- [toolspec-generator](https://github.com/alsaiz-es/toolspec-generator) — Claude Desktop skill that generates ToolSpec descriptors from API documentation automatically

## Roadmap

- [x] **v0.1 Spec** — JSON Schema for the three-layer descriptor
- [x] **TypeScript SDK** — loader, translator (OpenAI/Anthropic), executor, MCP proxy generator
- [x] **CLI** — `validate`, `connect`, `install`, `inspect`
- [x] **Schema validation** — full Ajv validation against the JSON Schema
- [x] **Example** — MusicBrainz API (46 tools, knowledge layer, workflow examples)
- [ ] **OpenAPI importer** — convert OpenAPI specs to ToolSpec descriptors
- [ ] **Python SDK**
- [ ] **Additional examples** — more real-world APIs beyond MusicBrainz
- [ ] **Evals** — reproducible benchmarks comparing tool selection/chaining with and without ToolSpec metadata

## Contributing

Contributions welcome — spec improvements, SDK ports, new API examples, and eval harnesses.

## License

Apache 2.0
