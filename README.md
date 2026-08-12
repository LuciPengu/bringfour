# vgc-tools-mcp

A local MCP server that gives an AI agent Pokemon VGC teambuilding intelligence:
what the meta looks like, how each Pokemon is actually built, which meta threats
your team is susceptible to (backed by real damage calcs, not type-chart
guessing), and a full damage calculator.

Defaults to the current official format — **Pokemon Champions, Regulation Set
M-B** — with SV Regulation I and other formats reachable via the `format`
parameter on every tool.

## Tools

| Tool | What it does |
| --- | --- |
| `meta_snapshot` | Top meta Pokemon with usage/win rates for a format. |
| `pokemon_deep_dive` | One Pokemon's common items, abilities, moves, spreads, natures, Tera types (SV), teammates. |
| `analyze_team` | Calc-backed threat report: for the top N meta Pokemon at their most common sets, real OHKO/2HKO threats against your actual EVs, plus speed tiers and speed-control flags (Tailwind/Trick Room/Icy Wind...). |
| `calc_damage` | Damage calc via `@smogon/calc`. Unspecified fields auto-fill from meta data; every assumption is echoed so the agent can override and re-call. |
| `save_team` / `list_teams` | Store Showdown-export pastes as plain text in `teams/`, so "analyze my worlds team" works without re-pasting. |

## Setup

```bash
npm install
```

The repo ships a project-scoped `.mcp.json`, so Claude Code picks the server up
automatically when working in this directory. For other clients, run it with
`npx tsx src/index.ts` (stdio transport).

```bash
npm test          # unit tests (fixture-based, no network)
npm run typecheck
npm run ui        # local dashboard at http://localhost:4747
```

## Web dashboard

`npm run ui` serves a local dashboard (dark, sprite-heavy, no build step) over
the same data layer as the MCP tools:

- **Threats** — pick a saved team, get the calc-backed threat report as cards
  with OHKO/2HKO badges, damage bars, a speed ladder, and speed-control flags.
- **Damage Calc** — attacker/defender panels that pre-fill the most common meta
  set (grayed-italic until you override a field, mirroring the MCP tool's
  assumption echoing), live results, field conditions, swap sides.
- **Teams** — create/edit Showdown pastes, or import from a pokepast.es link.
- **Meta / deep-dive** — sortable usage table; click through to per-Pokemon
  items, moves, spreads, natures, and teammates.

The header shows the active format, data source and month, with a Refresh
button that bypasses the 24h cache. Sprites are proxied from Pokemon Showdown's
public sprite sets and cached locally.

## Data sources & behavior

- **Pikalytics** (pikalytics.com) is the primary usage source — in-game ranked
  battle data for Champions, HOME battle data for SV. Pikalytics asks for
  attribution when citing its stats; every tool response carries it.
- **Smogon usage stats** (smogon.com/stats, Showdown ladder chaos JSON) are the
  automatic fallback when Pikalytics lacks a format.
- Responses are cached in `.cache/` for 24h; usage dumps are monthly, so the
  service walks back up to 7 months to find the newest published data.
- Teams are plain Showdown-export text files in `teams/` — edit them freely.

### Champions caveats (honest-approximation zone)

- Champions EVs run 0–32 per stat. For damage/stat math they are mapped onto
  the classic 0–252 scale (×8, capped); every calc that does this says so in
  its `assumptions`. Treat very close rolls with caution.
- Champions Mega formes ("Charizard-Mega-Y") mostly exist in `@smogon/calc`'s
  data already; anything the calc doesn't know is reported explicitly instead
  of guessed at.

## Out of scope (v1)

EV-spread optimization and tournament results/team lists (planned against the
documented Limitless API) are deliberate v2 items.
