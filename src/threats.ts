import { calculate, Field, Generations, Move, Pokemon } from '@smogon/calc';
import { scaleChampionsEvs, toID, ZERO_EVS } from './calc.js';
import type { MetaEntry, PokemonDetail, StatsTable, TeamMember } from './types.js';

const gen = Generations.get(9);

export type KOCategory =
  | 'guaranteed OHKO'
  | 'possible OHKO'
  | 'guaranteed 2HKO'
  | 'possible 2HKO'
  | '3HKO or worse';

export function classifyDamage(minPercent: number, maxPercent: number): KOCategory {
  if (minPercent >= 100) return 'guaranteed OHKO';
  if (maxPercent >= 100) return 'possible OHKO';
  if (minPercent >= 50) return 'guaranteed 2HKO';
  if (maxPercent >= 50) return 'possible 2HKO';
  return '3HKO or worse';
}

const SPEED_CONTROL_MOVES = [
  'Tailwind',
  'Trick Room',
  'Icy Wind',
  'Electroweb',
  'Thunder Wave',
  'Glare',
  'Nuzzle',
  'Bleakwind Storm',
  'Quash',
  'After You',
] as const;

const SPEED_CONTROL_IDS = new Map(SPEED_CONTROL_MOVES.map((m) => [toID(m), m]));

/** Returns the canonical names of speed-control moves found in a move list, in input order. */
export function detectSpeedControl(moves: string[]): string[] {
  return moves.flatMap((move) => {
    const hit = SPEED_CONTROL_IDS.get(toID(move));
    return hit ? [hit] : [];
  });
}

export interface SpeedInput {
  nature: string;
  evs: Partial<StatsTable>;
  level: number;
  ivs?: Partial<StatsTable>;
}

/** Actual speed stat at the given spread, or undefined if the species is unknown to the calc. */
export function computeSpeed(species: string, input: SpeedInput): number | undefined {
  if (!gen.species.get(toID(species))) return undefined;
  try {
    const mon = new Pokemon(gen, species, {
      level: input.level,
      nature: input.nature,
      evs: input.evs,
      ivs: input.ivs,
    });
    return mon.rawStats.spe;
  } catch {
    return undefined;
  }
}

export interface ThreatSet {
  species: string;
  item?: string;
  ability?: string;
  nature: string;
  evs: StatsTable;
  level: number;
}

export interface MemberThreat {
  member: string;
  bestMove: string;
  minPercent: number;
  maxPercent: number;
  category: KOCategory;
}

export interface ThreatEntry {
  name: string;
  rank?: number;
  usagePercent?: number;
  set: ThreatSet;
  /** Higher = more dangerous to this team overall. */
  score: number;
  vs: MemberThreat[];
  speed: {
    stat?: number;
    /** Team members this threat outspeeds (strictly faster). */
    outspeeds: string[];
    speedControl: string[];
  };
}

export interface SpeedTierRow {
  name: string;
  speed: number;
  side: 'team' | 'meta';
}

export interface ThreatReport {
  assumptions: string[];
  threats: ThreatEntry[];
  skipped: { name: string; reason: string }[];
  speedTiers: SpeedTierRow[];
  teamSpeed: {
    teamSize: number;
    threatCount: number;
    hasTailwind: boolean;
    hasTrickRoom: boolean;
    /** Members outsped by more than half of the analyzed threats. */
    underspeedCount: number;
  };
}

export interface ThreatOptions {
  metaList: MetaEntry[];
  topN?: number;
  evScale?: 'classic' | 'champions';
  /** Damaging moves tried per threat. */
  movesPerThreat?: number;
}

export interface ThreatDeps {
  detailFor: (species: string) => Promise<PokemonDetail | undefined>;
}

const CATEGORY_SCORE: Record<KOCategory, number> = {
  'guaranteed OHKO': 3,
  'possible OHKO': 2,
  'guaranteed 2HKO': 1.5,
  'possible 2HKO': 1,
  '3HKO or worse': 0,
};

export async function analyzeThreats(
  team: TeamMember[],
  options: ThreatOptions,
  deps: ThreatDeps,
): Promise<ThreatReport> {
  const evScale = options.evScale ?? 'classic';
  const topN = options.topN ?? 30;
  const movesPerThreat = options.movesPerThreat ?? 4;
  const field = new Field({ gameType: 'Doubles' });

  const assumptions: string[] = [
    "Threat sets use each meta Pokemon's most common item, ability, and spread; no Tera, no boosts, neutral field. " +
      'Spread moves include the doubles 0.75x reduction (hitting two targets); use calc_damage with singleTarget for lone-target rolls.',
  ];
  if (evScale === 'champions') {
    assumptions.push(
      'Champions EV units (0-32) were mapped onto the classic 0-252 scale (x8, capped at 252) on both sides; treat very close ranges with caution.',
    );
  }

  const scaleEvs = (evs: Partial<StatsTable>): Partial<StatsTable> =>
    evScale === 'champions' ? scaleChampionsEvs(evs) : evs;

  // Prepare my side once.
  interface Defender {
    member: TeamMember;
    mon: Pokemon;
    speed: number;
  }
  const defenders: Defender[] = [];
  const skipped: { name: string; reason: string }[] = [];
  for (const member of team) {
    if (!gen.species.get(toID(member.species))) {
      skipped.push({ name: member.species, reason: 'your Pokemon is not in calc data' });
      continue;
    }
    const mon = new Pokemon(gen, member.species, {
      level: member.level,
      item: member.item,
      ability: member.ability,
      nature: member.nature ?? 'Serious',
      evs: scaleEvs(member.evs),
      ivs: member.ivs,
    });
    defenders.push({ member, mon, speed: mon.rawStats.spe });
  }

  // Prefetch all meta details with bounded concurrency; on a cold cache these
  // are HTTP round-trips and running them serially dominates wall time.
  const metas = options.metaList.slice(0, topN);
  const details = new Array<PokemonDetail | undefined>(metas.length);
  const CONCURRENCY = 8;
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, metas.length) }, async () => {
      while (cursor < metas.length) {
        const i = cursor++;
        try {
          details[i] = await deps.detailFor(metas[i]!.name);
        } catch {
          details[i] = undefined;
        }
      }
    }),
  );

  const threats: ThreatEntry[] = [];
  for (const [metaIndex, meta] of metas.entries()) {
    const detail = details[metaIndex];
    if (!detail) {
      skipped.push({ name: meta.name, reason: 'no meta detail available' });
      continue;
    }
    if (!gen.species.get(toID(meta.name))) {
      skipped.push({ name: meta.name, reason: 'not in calc data (Champions-era addition?)' });
      continue;
    }

    const spread = detail.spreads[0];
    const nature = spread?.nature ?? detail.natures[0]?.name ?? 'Serious';
    const set: ThreatSet = {
      species: meta.name,
      item: detail.items[0]?.name,
      ability: detail.abilities[0]?.name,
      nature,
      level: 50,
      evs: { ...ZERO_EVS, ...scaleEvs(spread?.evs ?? {}) },
    };

    let attacker: Pokemon;
    try {
      attacker = new Pokemon(gen, set.species, {
        level: set.level,
        item: set.item,
        ability: set.ability,
        nature: set.nature,
        evs: set.evs,
      });
    } catch (err) {
      skipped.push({ name: meta.name, reason: `calc rejected the set: ${String(err)}` });
      continue;
    }

    const damagingMoves = detail.moves
      .map((m) => gen.moves.get(toID(m.name)))
      .filter((m): m is NonNullable<typeof m> => m !== undefined && m.category !== 'Status')
      .slice(0, movesPerThreat);

    const vs: MemberThreat[] = [];
    for (const defender of defenders) {
      let best: MemberThreat | undefined;
      for (const moveData of damagingMoves) {
        let minPercent = 0;
        let maxPercent = 0;
        try {
          const result = calculate(gen, attacker, defender.mon, new Move(gen, moveData.name), field);
          const [min, max] = result.range();
          const maxHP = defender.mon.maxHP();
          minPercent = Math.round((min / maxHP) * 1000) / 10;
          maxPercent = Math.round((max / maxHP) * 1000) / 10;
        } catch {
          continue;
        }
        if (!best || maxPercent > best.maxPercent) {
          best = {
            member: defender.member.species,
            bestMove: moveData.name,
            minPercent,
            maxPercent,
            category: classifyDamage(minPercent, maxPercent),
          };
        }
      }
      if (best) vs.push(best);
    }

    const stat = attacker.rawStats.spe;
    threats.push({
      name: meta.name,
      rank: meta.rank,
      usagePercent: meta.usagePercent,
      set,
      score: vs.reduce((sum, v) => sum + CATEGORY_SCORE[v.category], 0),
      vs,
      speed: {
        stat,
        outspeeds: defenders.filter((d) => stat > d.speed).map((d) => d.member.species),
        speedControl: detectSpeedControl(detail.moves.map((m) => m.name)),
      },
    });
  }

  threats.sort((a, b) => b.score - a.score);

  const speedTiers: SpeedTierRow[] = [
    ...defenders.map((d) => ({ name: d.member.species, speed: d.speed, side: 'team' as const })),
    ...threats.flatMap((t) => (t.speed.stat === undefined ? [] : [{ name: t.name, speed: t.speed.stat, side: 'meta' as const }])),
  ].sort((a, b) => b.speed - a.speed);

  const teamMoveIds = new Set(team.flatMap((m) => m.moves.map((move) => toID(move))));
  const underspeedCount = defenders.filter(
    (d) => threats.filter((t) => (t.speed.stat ?? 0) > d.speed).length > threats.length / 2,
  ).length;

  return {
    assumptions,
    threats,
    skipped,
    speedTiers,
    teamSpeed: {
      teamSize: defenders.length,
      threatCount: threats.length,
      hasTailwind: teamMoveIds.has(toID('Tailwind')),
      hasTrickRoom: teamMoveIds.has(toID('Trick Room')),
      underspeedCount,
    },
  };
}
