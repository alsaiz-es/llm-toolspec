# Demo: MusicBrainz MCP proxy in Claude Desktop

End-to-end demo of the ToolSpec MCP proxy running in Claude Desktop, navigating the full MusicBrainz entity hierarchy with zero custom logic — just HTTP calls proxied through a `toolspec.json` descriptor.

## Setup

The MusicBrainz ToolSpec (46 tools) was generated with the [toolspec-generator](https://github.com/alsaiz-es/toolspec-generator) skill and installed as an MCP server:

```bash
npx tsx src/cli/index.ts install musicbrainz.toolspec.json
# Restart Claude Desktop
```

Claude Desktop discovered all 46 tools automatically:

| Operation | Tools |
|-----------|-------|
| Lookups (14) | lookup_artist, lookup_release, lookup_recording, lookup_release_group, lookup_label, lookup_area, lookup_event, lookup_instrument, lookup_place, lookup_work, lookup_series, lookup_isrc, lookup_iswc, lookup_discid |
| Browses (13) | browse_artists, browse_releases, browse_recordings, browse_release_groups, browse_labels, browse_events, browse_places, browse_collections, browse_works, browse_series, browse_instruments, browse_areas |
| Searches (15) | search_artists, search_releases, search_recordings, search_release_groups, search_labels, search_events, search_places, search_instruments, search_works, search_series, search_cdstubs, search_urls, search_annotations, search_tags |
| Special (1) | list_all_genres |

## The test: Artist -> Release Group -> Release -> Recording

Prompt: *"Buscar Radiohead -> sus albums -> tracklist de OK Computer -> lookup de un recording concreto"*

### Step 1: search_artists

```json
{ "query": "radiohead", "fmt": "json", "limit": 1 }
```

Found **Radiohead** — MBID `a74b1b7f-71a5-4011-9441-d0b5e4122711`.

### Step 2: browse_release_groups

```json
{ "artist": "a74b1b7f-71a5-4011-9441-d0b5e4122711", "fmt": "json", "type": "album" }
```

382 release groups. Found **OK Computer** — release group `b1392450-e666-3926-a536-22c65f834433`.

### Step 3: browse_releases

```json
{ "release-group": "b1392450-e666-3926-a536-22c65f834433", "fmt": "json", "status": "official" }
```

38 official editions. Selected UK EMI Swindon pressing — release `c7569949-...`.

### Step 4: lookup_release

```json
{ "mbid": "c7569949-...", "fmt": "json", "inc": "recordings+artist-credits" }
```

Full tracklist, 12 tracks:

1. Airbag
2. Paranoid Android
3. Subterranean Homesick Alien
4. Exit Music (For a Film)
5. Let Down
6. Karma Police
7. Fitter Happier
8. Electioneering
9. Climbing Up the Walls
10. No Surprises
11. Lucky
12. The Tourist

### Step 5: lookup_recording

```json
{ "mbid": "<paranoid-android-recording-mbid>", "fmt": "json", "inc": "artists+tags+genres" }
```

**Paranoid Android** — 6:24, genres: alternative rock, art rock, progressive rock. First release: 1997-05-21.

## Result

The full chain `Artist -> Release Group -> Release -> Recording` navigated without gaps, across 5 tool calls — all through an MCP proxy with zero MusicBrainz-specific logic. The proxy just routes HTTP calls based on the `toolspec.json` descriptor.

This is what ToolSpec enables: any API becomes a set of LLM tools by publishing a JSON descriptor. No plugins, no custom code, no local processes.
