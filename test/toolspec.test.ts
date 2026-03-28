import { describe, it, expect } from "vitest";
import { ToolSpec } from "../src/sdk/loader.js";
import { translate } from "../src/sdk/translator.js";
import { execute } from "../src/sdk/executor.js";

const EXAMPLE = "spec/examples/musicbrainz.toolspec.json";

describe("ToolSpec loader", () => {
  it("loads MusicBrainz example from file", async () => {
    const spec = await ToolSpec.fromFile(EXAMPLE);
    expect(spec.name).toBe("MusicBrainz");
    expect(spec.toolNames).toContain("search_artists");
    expect(spec.toolNames).toContain("lookup_artist");
    expect(spec.toolNames).toContain("browse_release_groups");
    expect(spec.toolNames.length).toBeGreaterThan(30);
  });

  it("rejects invalid descriptor", async () => {
    await expect(
      ToolSpec.fromFile("package.json")
    ).rejects.toThrow();
  });
});

describe("translator", () => {
  it("translates to Anthropic format", async () => {
    const spec = await ToolSpec.fromFile(EXAMPLE);
    const tools = translate(spec.descriptor, "anthropic");

    expect(tools.length).toBeGreaterThan(30);

    const searchArtists = tools.find((t: any) => t.name === "search_artists") as {
      name: string;
      description: string;
      input_schema: unknown;
    };
    expect(searchArtists).toBeDefined();
    expect(searchArtists.description).toContain("artist");
    expect(searchArtists.description).toContain("When to use");
    expect(searchArtists.input_schema).toBeDefined();
  });

  it("translates to OpenAI format", async () => {
    const spec = await ToolSpec.fromFile(EXAMPLE);
    const tools = translate(spec.descriptor, "openai");

    const first = tools[0] as { type: string; function: { name: string } };
    expect(first.type).toBe("function");
    expect(first.function.name).toBeDefined();
  });
});

describe("executor", () => {
  // Tests hit the live MusicBrainz API (1 req/sec rate limit).
  // We test one representative method per API pattern: search, lookup, browse.

  it("search: search_artists with query params", async () => {
    const spec = await ToolSpec.fromFile(EXAMPLE);

    const result = await execute(spec.descriptor, "search_artists", {
      query: "radiohead",
      fmt: "json",
      limit: 1,
    });

    expect(result.status).toBe(200);
    const data = result.data as { artists: Array<{ id: string; name: string }> };
    expect(data.artists.length).toBeGreaterThan(0);
    expect(data.artists[0].name.toLowerCase()).toContain("radiohead");
  });

  it("lookup: lookup_artist with path parameter {mbid}", async () => {
    const spec = await ToolSpec.fromFile(EXAMPLE);

    // Radiohead MBID
    const result = await execute(spec.descriptor, "lookup_artist", {
      mbid: "a74b1b7f-71a5-4011-9441-d0b5e4122711",
      fmt: "json",
    });

    expect(result.status).toBe(200);
    const data = result.data as { id: string; name: string };
    expect(data.name).toBe("Radiohead");
  });

  it("browse: browse_release_groups linked to artist", async () => {
    const spec = await ToolSpec.fromFile(EXAMPLE);

    // Browse Radiohead's albums
    const result = await execute(spec.descriptor, "browse_release_groups", {
      artist: "a74b1b7f-71a5-4011-9441-d0b5e4122711",
      fmt: "json",
      type: "album",
      limit: 3,
    });

    expect(result.status).toBe(200);
    const data = result.data as { "release-groups": Array<{ id: string; title: string }> };
    expect(data["release-groups"].length).toBeGreaterThan(0);
  });
});
