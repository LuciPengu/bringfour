# Data pipeline: Smogon-primary for paid surfaces, Pikalytics for free ones

The Copilot (and any future monetized surface) sources usage stats from Smogon's aggregated stats (chaos JSON) as primary; the free OSS Server and Dashboard keep Pikalytics-primary with attribution, as today.

Why: Smogon's aggregated stats are treated as freely reusable/public domain by the pkmn maintainers, making them the most defensible input for a commercial product. Pikalytics has no ToS and a permissive robots.txt, but it is a fellow aggregator monetizing the same niche — scraping it to power a paid competitor is the weakest link in an otherwise clean legal posture (see ADR-0002).

Verified 2026-08-12: Smogon's archive covers Champions — `gen9championsvgc2026regmb` (and `-bo3`) exist in the 2026-07 dump at all four rating cutoffs, with full chaos JSON (`chaos/gen9championsvgc2026regmb-1760.json`). Smogon-primary is therefore viable for every format the product ships. Remaining caveat: Smogon's numbers reflect the *Showdown* Champions ladder population, while Pikalytics carries in-game ranked data — a data-quality difference, not a legal one. The free OSS surfaces keep Pikalytics-primary (better data, attribution given); the Copilot uses Smogon-primary (cleanest rights posture).
