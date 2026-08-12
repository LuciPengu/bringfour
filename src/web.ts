#!/usr/bin/env node
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { Dex } from '@pkmn/dex';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCalc, toID, type CalcPokemonInput } from './calc.js';
import { KNOWN_FORMATS, resolveFormat } from './formats.js';
import { parseShowdownPaste } from './paste.js';
import { DataService, GENERIC_ATTRIBUTION } from './sources.js';
import { TeamStore } from './teams.js';
import { analyzeThreats } from './threats.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 4747;
const service = new DataService({ cacheDir: join(ROOT, '.cache') });
const teams = new TeamStore(join(ROOT, 'teams'));
const SPRITE_DIR = join(ROOT, '.cache', 'sprites');
mkdirSync(SPRITE_DIR, { recursive: true });

const gen9 = Dex.forGen(9);

/** Showdown sprite filename: base species id, then forme id after a hyphen. */
function spriteId(species: string): string {
  const s = gen9.species.get(toID(species));
  if (!s) return toID(species);
  if (!s.forme) return s.id;
  return `${toID(s.baseSpecies)}-${toID(s.forme)}`;
}

const app = new Hono();

app.get('/api/config', (c) =>
  c.json({
    formats: KNOWN_FORMATS.map((f) => ({ id: f.id, label: f.label, evScale: f.evScale, teraAllowed: f.teraAllowed })),
    defaultFormat: KNOWN_FORMATS[0]!.id,
  }),
);

app.get('/api/species', (c) => {
  const names = gen9.species.all().map((s) => s.name);
  return c.json(names);
});

app.get('/api/meta', async (c) => {
  const format = resolveFormat(c.req.query('format'));
  if (c.req.query('refresh') === '1') service.refreshFormat(format);
  const result = await service.metaList(format);
  if (!result) {
    return c.json({ error: `No usage data found for ${format.label} on either source.` }, 404);
  }
  return c.json({
    format: { id: format.id, label: format.label, evScale: format.evScale, teraAllowed: format.teraAllowed },
    source: result.source,
    month: result.month,
    rating: result.rating,
    attribution: result.attribution,
    entries: result.entries.map((e) => ({ ...e, sprite: spriteId(e.name) })),
  });
});

app.get('/api/pokemon/:name', async (c) => {
  const format = resolveFormat(c.req.query('format'));
  const name = c.req.param('name');
  const result = await service.detail(format, name);
  if (!result) return c.json({ error: `No usage data for "${name}" in ${format.label}.` }, 404);
  return c.json({
    format: { id: format.id, label: format.label, evScale: format.evScale, teraAllowed: format.teraAllowed },
    attribution: result.attribution,
    sprite: spriteId(result.detail.name),
    ...result.detail,
    teammates: result.detail.teammates.map((t) => ({ ...t, sprite: spriteId(t.name) })),
  });
});

app.get('/api/teams', (c) =>
  c.json(
    teams.list().map((t) => ({
      ...t,
      paste: teams.load(t.name) ?? '',
      sprites: t.species.map(spriteId),
    })),
  ),
);

app.put('/api/teams/:name', async (c) => {
  const { paste } = await c.req.json<{ paste: string }>();
  try {
    return c.json(teams.save(c.req.param('name'), paste));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

app.delete('/api/teams/:name', (c) => {
  const ok = teams.delete(c.req.param('name'));
  return ok ? c.json({ deleted: true }) : c.json({ error: 'No such team.' }, 404);
});

app.post('/api/teams/import', async (c) => {
  const { url, name } = await c.req.json<{ url: string; name: string }>();
  if (!url || !name) return c.json({ error: 'Both url and name are required.' }, 400);
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return c.json({ error: 'That is not a valid URL.' }, 400);
  }
  if (target.hostname !== 'pokepast.es') {
    return c.json({ error: 'Only pokepast.es links are supported.' }, 400);
  }
  if (!target.pathname.endsWith('/raw')) target.pathname = target.pathname.replace(/\/$/, '') + '/raw';
  try {
    const res = await fetch(target, { headers: { 'user-agent': 'vgc-tools-mcp/0.1' } });
    if (!res.ok) return c.json({ error: `pokepast.es answered HTTP ${res.status}.` }, 502);
    const paste = await res.text();
    return c.json(teams.save(name, paste));
  } catch (err) {
    return c.json({ error: `Import failed: ${err instanceof Error ? err.message : String(err)}` }, 502);
  }
});

app.post('/api/analyze', async (c) => {
  const body = await c.req.json<{ team_name?: string; paste?: string; format?: string; top_n?: number }>();
  const format = resolveFormat(body.format);
  const paste = body.paste ?? (body.team_name ? teams.load(body.team_name) : undefined);
  if (!paste) return c.json({ error: 'Provide paste or team_name.' }, 400);
  const team = parseShowdownPaste(paste);
  if (team.length === 0) return c.json({ error: 'That paste parsed to zero Pokemon.' }, 400);
  const meta = await service.metaList(format);
  if (!meta) return c.json({ error: `No usage data available for ${format.label}.` }, 404);
  const report = await analyzeThreats(
    team,
    { metaList: meta.entries, topN: body.top_n ?? 30, evScale: format.evScale },
    { detailFor: async (species) => (await service.detail(format, species))?.detail },
  );
  return c.json({
    format: { id: format.id, label: format.label, evScale: format.evScale },
    team: team.map((m) => ({ species: m.species, sprite: spriteId(m.species) })),
    attribution: meta.attribution,
    ...report,
    threats: report.threats.map((t) => ({ ...t, sprite: spriteId(t.name) })),
  });
});

app.post('/api/calc', async (c) => {
  const body = await c.req.json<{
    attacker: CalcPokemonInput;
    defender: CalcPokemonInput;
    move: string;
    format?: string;
    field?: {
      weather?: string;
      terrain?: string;
      singleTarget?: boolean;
      attackerHelpingHand?: boolean;
      defenderReflect?: boolean;
      defenderLightScreen?: boolean;
      defenderAuroraVeil?: boolean;
    };
  }>();
  const format = resolveFormat(body.format);
  const outcome = await runCalc(
    { attacker: body.attacker, defender: body.defender, move: body.move, evScale: format.evScale, field: body.field },
    { detailFor: async (species) => (await service.detail(format, species))?.detail },
  );
  return c.json({ format: { id: format.id, label: format.label, evScale: format.evScale }, attribution: GENERIC_ATTRIBUTION, ...outcome });
});

app.get('/sprites/:name', async (c) => {
  const requested = c.req.param('name').replace(/\.png$/, '');
  // Sprite ids are [a-z0-9-]; anything else is a bad request, not a path.
  if (!/^[a-z0-9-]+$/.test(requested)) return c.body('bad sprite id', 400);
  const local = join(SPRITE_DIR, `${requested}.png`);
  if (!existsSync(local)) {
    try {
      const res = await fetch(`https://play.pokemonshowdown.com/sprites/gen5/${requested}.png`);
      if (!res.ok) return c.body('not found', 404);
      writeFileSync(local, Buffer.from(await res.arrayBuffer()));
    } catch {
      return c.body('fetch failed', 502);
    }
  }
  return c.body(readFileSync(local), 200, {
    'content-type': 'image/png',
    'cache-control': 'public, max-age=604800',
  });
});

app.use('/*', serveStatic({ root: 'public' }));
app.get('/', serveStatic({ path: 'public/index.html' }));

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`vgc-tools UI running at http://localhost:${PORT}`);
});
