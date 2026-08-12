import { Dex } from '@pkmn/dex';
import type { MetaEntry, PokemonDetail, RankedShare, SpreadShare, StatsTable } from './types.js';
import { parseSpread } from './spread.js';

const gen9 = Dex.forGen(9);

function num(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** "2/32/0/0/0/32" → StatsTable. */
function parseEvString(raw: string): StatsTable | undefined {
  const parts = raw.trim().split('/').map((p) => Number(p.trim()));
  if (parts.length !== 6 || parts.some((p) => !Number.isFinite(p))) return undefined;
  return { hp: parts[0]!, atk: parts[1]!, def: parts[2]!, spa: parts[3]!, spd: parts[4]!, spe: parts[5]! };
}

// ---------------------------------------------------------------------------
// Pikalytics
// ---------------------------------------------------------------------------

interface PikaListEntry {
  name: string;
  rank?: string | number;
  ranking?: string | number;
  winPercent?: string | number;
  games?: number | null;
  types?: string[] | null;
  stats?: StatsTable | null;
  percent?: string | number | null;
}

export function normalizePikalyticsList(raw: unknown): MetaEntry[] {
  if (!Array.isArray(raw)) return [];
  return (raw as PikaListEntry[]).map((entry, index) => ({
    name: entry.name,
    rank: num(entry.rank ?? entry.ranking) ?? index + 1,
    usagePercent: num(entry.percent),
    winPercent: num(entry.winPercent),
    games: entry.games ?? undefined,
    types: entry.types ?? undefined,
  }));
}

interface PikaDetail extends PikaListEntry {
  abilities?: { ability: string; percent: string }[] | null;
  items?: { item: string; percent: string }[] | null;
  moves?: { move: string; percent: string }[] | null;
  natures?: { nature: string; percent: string }[] | null;
  spreads?: { nature: string; ev: string; percent: string }[] | null;
  teammates?: { pokemon?: string; name?: string; percent?: string }[] | null;
  team?: { pokemon: string; rank: number }[] | null;
  teratypes?: { teratype: string; percent: string }[] | null;
}

function shares<T>(
  rows: T[] | null | undefined,
  name: (row: T) => string | undefined,
  percent: (row: T) => unknown,
): RankedShare[] {
  return (rows ?? []).flatMap((row) => {
    const n = name(row);
    return n ? [{ name: n, percent: num(percent(row)) }] : [];
  });
}

export function normalizePikalyticsDetail(raw: unknown): PokemonDetail {
  const d = raw as PikaDetail;
  const spreads: SpreadShare[] = (d.spreads ?? []).flatMap((s) => {
    const evs = parseEvString(s.ev);
    const percent = num(s.percent);
    if (!evs || percent === undefined) return [];
    return [{ nature: s.nature || undefined, evs, percent }];
  });

  const teammates: RankedShare[] =
    d.teammates && d.teammates.length > 0
      ? shares(d.teammates, (t) => t.pokemon ?? t.name, (t) => t.percent)
      : (d.team ?? []).map((t) => ({ name: t.pokemon, percent: undefined }));

  return {
    name: d.name,
    source: 'pikalytics',
    types: d.types ?? undefined,
    baseStats: d.stats ?? undefined,
    rank: num(d.rank ?? d.ranking),
    winPercent: num(d.winPercent),
    usagePercent: num(d.percent),
    abilities: shares(d.abilities, (a) => a.ability, (a) => a.percent),
    items: shares(d.items, (i) => i.item, (i) => i.percent),
    moves: shares(d.moves, (m) => m.move, (m) => m.percent),
    natures: shares(d.natures, (n) => n.nature, (n) => n.percent),
    teraTypes: shares(d.teratypes, (t) => t.teratype, (t) => t.percent),
    spreads,
    teammates,
  };
}

// ---------------------------------------------------------------------------
// Smogon chaos
// ---------------------------------------------------------------------------

interface ChaosEntry {
  usage: number;
  'Raw count': number;
  Abilities: Record<string, number>;
  Items: Record<string, number>;
  Moves: Record<string, number>;
  Spreads: Record<string, number>;
  'Tera Types'?: Record<string, number>;
  Teammates: Record<string, number>;
}

export interface ChaosDump {
  info: { metagame: string; cutoff: number; 'number of battles': number };
  data: Record<string, ChaosEntry>;
}

function sortedEntries(table: Record<string, number> | undefined): [string, number][] {
  return Object.entries(table ?? {})
    .filter(([key]) => key !== '')
    .sort((a, b) => b[1] - a[1]);
}

function displayName(kind: 'move' | 'item' | 'ability', id: string): string {
  const hit =
    kind === 'move' ? gen9.moves.get(id) : kind === 'item' ? gen9.items.get(id) : gen9.abilities.get(id);
  // Champions-era ids may be missing from the dex; fall back to the raw id.
  return hit?.exists ? hit.name : id;
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

export function normalizeChaosList(dump: ChaosDump): MetaEntry[] {
  return Object.entries(dump.data)
    .sort((a, b) => b[1].usage - a[1].usage)
    .map(([name, entry], index) => ({
      name,
      rank: index + 1,
      usagePercent: round2(entry.usage * 100),
    }));
}

export function normalizeChaosDetail(dump: ChaosDump, name: string): PokemonDetail | undefined {
  const entry = dump.data[name];
  if (!entry) return undefined;

  // The mon's total weighted count: every set has exactly one ability.
  const total = Object.values(entry.Abilities).reduce((sum, v) => sum + v, 0);
  const pct = (v: number): number => (total > 0 ? round2((v / total) * 100) : 0);

  const toShares = (kind: 'move' | 'item' | 'ability', table: Record<string, number>): RankedShare[] =>
    sortedEntries(table).map(([id, weight]) => ({ name: displayName(kind, id), percent: pct(weight) }));

  const spreads: SpreadShare[] = sortedEntries(entry.Spreads).flatMap(([key, weight]) => {
    const parsed = parseSpread(key);
    if (!parsed) return [];
    return [{ nature: parsed.nature, evs: parsed.evs, percent: pct(weight) }];
  });

  const natureWeights = new Map<string, number>();
  for (const spread of spreads) {
    if (!spread.nature) continue;
    natureWeights.set(spread.nature, (natureWeights.get(spread.nature) ?? 0) + spread.percent);
  }
  const natures: RankedShare[] = [...natureWeights.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([nature, percent]) => ({ name: nature, percent: round2(percent) }));

  return {
    name,
    source: 'smogon',
    usagePercent: round2(entry.usage * 100),
    abilities: toShares('ability', entry.Abilities),
    items: toShares('item', entry.Items),
    moves: toShares('move', entry.Moves),
    natures,
    teraTypes: sortedEntries(entry['Tera Types']).map(([type, weight]) => ({
      name: capitalize(type),
      percent: pct(weight),
    })),
    spreads,
    teammates: sortedEntries(entry.Teammates).map(([mate, weight]) => ({
      name: mate,
      percent: pct(weight),
    })),
  };
}
