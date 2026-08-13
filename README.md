# vgc-tools-mcp

**Give your AI assistant a competitive Pokémon brain.** An MCP server (plus a
local web dashboard) that turns Claude, Cursor, or any MCP client into a VGC
teambuilding partner — real usage stats, real damage calcs, and threat reports
grounded in math instead of type-chart guessing.

> 🚧 *Pre-1.0: the project is being renamed before its npm publish. Until then,
> use the [from-source setup](#from-source) — everything works today.*

<!-- TODO(launch): record docs/threat-report.gif — paste team → threat cards -->
![Calc-backed threat report](docs/threat-report.gif)

Ask *"what beats my trick room team?"* and get back OHKO/2HKO lines computed
with `@smogon/calc` against the top meta Pokémon **at their actual most common
spreads** — not vibes. Defaults to the current official format (**Pokémon
Champions, Regulation Set M-B**); SV Regulation I and other formats are one
`format` parameter away.

## Quick start

### Claude Code

```bash
claude mcp add vgc-tools -- npx -y vgc-tools-mcp
```

### Claude Desktop / Cursor

```json
{
  "mcpServers": {
    "vgc-tools": {
      "command": "npx",
      "args": ["-y", "vgc-tools-mcp"]
    }
  }
}
```

### From source

```bash
git clone <this repo> && cd <repo> && npm install
```

The repo ships a project-scoped `.mcp.json`, so Claude Code picks the server
up automatically when working in this directory. For other clients, run
`npx tsx src/index.ts` (stdio transport).

## Tools

| Tool | What it does |
| --- | --- |
| `meta_snapshot` | Top meta Pokemon with usage/win rates for a format. |
| `pokemon_deep_dive` | One Pokemon's common items, abilities, moves, spreads, natures, Tera types (SV), teammates. |
| `analyze_team` | Calc-backed threat report: for the top N meta Pokemon at their most common sets, real OHKO/2HKO threats against your actual EVs, plus speed tiers and speed-control flags (Tailwind/Trick Room/Icy Wind...). |
| `calc_damage` | Damage calc via `@smogon/calc`. Unspecified fields auto-fill from meta data; every assumption is echoed so the agent can override and re-call. |
| `save_team` / `list_teams` | Store Showdown-export pastes as plain text, so "analyze my worlds team" works without re-pasting. |

## Web dashboard

```bash
npm run ui        # http://localhost:4747
```

A local dashboard (dark, sprite-heavy, no build step) over the same data layer
as the MCP tools:

- **Threats** — pick a saved team, get the calc-backed threat report as cards
  with OHKO/2HKO badges, damage bars, a speed ladder, and speed-control flags.
- **Damage Calc** — attacker/defender panels that pre-fill the most common meta
  set (grayed-italic until you override a field), live results, field
  conditions, swap sides.
- **Teams** — create/edit Showdown pastes, or import from a pokepast.es link.
- **Meta / deep-dive** — sortable usage table; click through to per-Pokemon
  items, moves, spreads, natures, and teammates.

## Where data lives

Running from a checkout (or any directory containing a `teams/` folder) keeps
teams in `./teams/` and the 24h usage-data cache in `./.cache/`, as always.
Running via `npx`/global install falls back to `~/.vgc-tools/`. Override with:

| Env var | Effect |
| --- | --- |
| `VGC_TOOLS_HOME` | Base directory for both (`<home>/teams`, `<home>/cache`) |
| `VGC_TEAMS_DIR` | Teams directory only |
| `VGC_CACHE_DIR` | Cache directory only |

## Data sources & behavior

- **Pikalytics** (pikalytics.com) is the primary usage source — in-game ranked
  battle data for Champions, HOME battle data for SV. Pikalytics asks for
  attribution when citing its stats; every tool response carries it.
- **Smogon usage stats** (smogon.com/stats, Showdown ladder chaos JSON) are the
  automatic fallback when Pikalytics lacks a format.
- Usage dumps are monthly; the service walks back up to 7 months to find the
  newest published data, and caches responses for 24h.
- Teams are plain Showdown-export text files — edit them freely.

### Champions caveats (honest-approximation zone)

- Champions EVs run 0–32 per stat. For damage/stat math they are mapped onto
  the classic 0–252 scale (×8, capped); every calc that does this says so in
  its `assumptions`. Treat very close rolls with caution.
- Champions Mega formes ("Charizard-Mega-Y") mostly exist in `@smogon/calc`'s
  data already; anything the calc doesn't know is reported explicitly instead
  of guessed at.

## Roadmap

- **v2:** EV-spread optimization; tournament results/team lists via the
  documented Limitless API.
- **Hosted copilot:** a web app where a frontier model writes full team
  coaching reports over these tools — in design, gated on this repo proving
  demand. Star the repo if you want it to exist.

## Support

<!-- TODO(launch): add GitHub Sponsors / Ko-fi link -->
If this saves you a ladder session of scouting, a star is the best signal you
can send.

## License & legal

MIT — see [LICENSE](LICENSE).

Unofficial fan tool — not affiliated with, endorsed, or supported by Nintendo,
Creatures Inc., GAME FREAK, or The Pokémon Company. Pokémon and all respective
names are trademarks of their owners. Usage data courtesy of
[Pikalytics](https://www.pikalytics.com) (attribution requested) and
[Smogon usage stats](https://www.smogon.com/stats/); damage math by
[@smogon/calc](https://github.com/smogon/damage-calc) (MIT); sprites served
from Pokémon Showdown's public sprite sets.
