# OSS Launch Checklist (Phase 1)

"Launched" means every box below is checked. The Copilot (paid, phase 2) is
explicitly out of scope here — see docs/adr/0001.

## Product

- [x] Create the GitHub repository and push (github.com/LuciPengu/bringfour).
- [x] Product name picked: **bringfour** (availability verified 2026-08-12); repo/package renamed.
- [ ] One-line install: `npx`-runnable MCP server (no clone + `tsx` required),
      with copy-paste config blocks for Claude Desktop, Claude Code, and Cursor.
- [ ] Deployed read-only Dashboard demo on Vercel (free tier), linked from the
      README header.

## README as pitch

- [ ] Rewrite README: install block up top, GIF of the calc-backed threat
      report, one-paragraph "why this beats type-chart guessing".
- [ ] MIT license.
- [ ] "Unofficial — not affiliated with Nintendo, Creatures Inc., GAME FREAK,
      or The Pokémon Company" disclaimer (README + Dashboard footer).
      Official Showdown sprites stay (community norm, per grill Q4).
- [ ] Data attributions: Pikalytics (they request attribution) and Smogon
      usage stats.
- [ ] GitHub Sponsors / Ko-fi link.

## Distribution (launch day)

- [ ] r/VGC post (lead with the threat-report GIF, not the MCP angle).
- [ ] MCP directories + awesome-MCP lists (lead with the MCP angle).
- [ ] X/Bluesky VGC circles.
- [ ] Skip HN at launch; save a "what I learned" Show HN for later.

## After launch

- [ ] Watch stars + sponsor clicks as the demand signal that gates Copilot
      work (ADR-0001).
