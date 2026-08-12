import { calculate, Field, Generations, Move, Pokemon } from '@smogon/calc';
import type { PokemonDetail, StatsTable } from './types.js';

const gen = Generations.get(9);

export interface CalcPokemonInput {
  species: string;
  item?: string;
  ability?: string;
  nature?: string;
  level?: number;
  teraType?: string;
  evs?: Partial<StatsTable>;
  ivs?: Partial<StatsTable>;
  boosts?: Partial<StatsTable>;
}

export interface CalcFieldInput {
  weather?: string;
  terrain?: string;
  /** Calc as if hitting a single target (skip the doubles spread reduction). */
  singleTarget?: boolean;
  attackerHelpingHand?: boolean;
  defenderReflect?: boolean;
  defenderLightScreen?: boolean;
  defenderAuroraVeil?: boolean;
}

export interface CalcRequest {
  attacker: CalcPokemonInput;
  defender: CalcPokemonInput;
  move: string;
  /** 'champions' means EVs are on the new game's 0-32 scale and get mapped to 0-252. */
  evScale?: 'classic' | 'champions';
  field?: CalcFieldInput;
}

export interface ResolvedSet {
  species: string;
  item?: string;
  ability?: string;
  nature: string;
  level: number;
  teraType?: string;
  evs: StatsTable;
}

export interface CalcOutcome {
  ok: boolean;
  error?: string;
  description?: string;
  damage?: { min: number; max: number; minPercent: number; maxPercent: number };
  koChance?: string;
  attacker?: ResolvedSet;
  defender?: ResolvedSet;
  assumptions: string[];
}

export interface CalcDeps {
  /** Meta-data lookup used to fill unspecified fields. */
  detailFor: (species: string) => Promise<PokemonDetail | undefined>;
}

export function toID<T extends string>(name: string): T {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '') as T;
}

export const ZERO_EVS: StatsTable = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

export function scaleChampionsEvs(evs: Partial<StatsTable>): Partial<StatsTable> {
  const out: Partial<StatsTable> = {};
  for (const [key, value] of Object.entries(evs) as [keyof StatsTable, number][]) {
    out[key] = Math.min(252, value * 8);
  }
  return out;
}

const WEATHER_ALIASES: Record<string, string> = {
  sun: 'Sun',
  sunny: 'Sun',
  sunnyday: 'Sun',
  rain: 'Rain',
  raindance: 'Rain',
  sand: 'Sand',
  sandstorm: 'Sand',
  snow: 'Snow',
  snowscape: 'Snow',
  hail: 'Snow',
  harshsunshine: 'Harsh Sunshine',
  desolateland: 'Harsh Sunshine',
  heavyrain: 'Heavy Rain',
  primordialsea: 'Heavy Rain',
  strongwinds: 'Strong Winds',
  deltastream: 'Strong Winds',
};

const TERRAIN_ALIASES: Record<string, string> = {
  electric: 'Electric',
  electricterrain: 'Electric',
  grassy: 'Grassy',
  grassyterrain: 'Grassy',
  psychic: 'Psychic',
  psychicterrain: 'Psychic',
  misty: 'Misty',
  mistyterrain: 'Misty',
};

/**
 * @smogon/calc matches field conditions by exact string equality and silently
 * ignores anything else, so unknown inputs must be an error, never a no-op.
 */
function normalizeFieldName(
  kind: 'weather' | 'terrain',
  input: string | undefined,
): { value?: string; error?: string } {
  if (input === undefined) return {};
  const table = kind === 'weather' ? WEATHER_ALIASES : TERRAIN_ALIASES;
  const hit = table[toID(input)];
  if (hit) return { value: hit };
  const accepted = [...new Set(Object.values(table))].join(', ');
  return { error: `Unknown ${kind} "${input}". Accepted values: ${accepted}.` };
}

interface ResolvedInput {
  set: ResolvedSet;
  assumptions: string[];
}

async function resolveSet(
  input: CalcPokemonInput,
  role: 'attacker' | 'defender',
  evScale: 'classic' | 'champions',
  deps: CalcDeps,
): Promise<ResolvedInput> {
  const assumptions: string[] = [];
  const needsFill =
    input.item === undefined ||
    input.ability === undefined ||
    input.nature === undefined ||
    input.evs === undefined;

  const detail = needsFill ? await deps.detailFor(input.species) : undefined;
  if (needsFill && !detail) {
    assumptions.push(
      `${role} ${input.species}: no meta data found; unspecified fields use neutral defaults (Serious, 0 EVs).`,
    );
  }

  let item = input.item;
  if (item === undefined && detail?.items[0]) {
    item = detail.items[0].name;
    assumptions.push(`${role} ${input.species}: assuming most common item ${item}.`);
  }

  let ability = input.ability;
  if (ability === undefined && detail?.abilities[0]) {
    ability = detail.abilities[0].name;
    assumptions.push(`${role} ${input.species}: assuming most common ability ${ability}.`);
  }

  let nature = input.nature;
  let evs = input.evs;
  if (evs === undefined) {
    const spread = detail?.spreads[0];
    if (spread) {
      evs = spread.evs;
      if (nature === undefined) nature = spread.nature;
      assumptions.push(
        `${role} ${input.species}: assuming most common spread ${spread.nature ?? '?'}:` +
          `${spread.evs.hp}/${spread.evs.atk}/${spread.evs.def}/${spread.evs.spa}/${spread.evs.spd}/${spread.evs.spe}.`,
      );
    }
  }
  if (nature === undefined && detail?.natures[0]) {
    nature = detail.natures[0].name;
    assumptions.push(`${role} ${input.species}: assuming most common nature ${nature}.`);
  }
  nature ??= 'Serious';
  evs ??= {};

  if (evScale === 'champions') {
    evs = scaleChampionsEvs(evs);
  }

  return {
    set: {
      species: input.species,
      item,
      ability,
      nature,
      level: input.level ?? 50,
      teraType: input.teraType,
      evs: { ...ZERO_EVS, ...evs },
    },
    assumptions,
  };
}

/** Runs a damage calc, auto-filling unspecified set details from meta data. */
export async function runCalc(request: CalcRequest, deps: CalcDeps): Promise<CalcOutcome> {
  const evScale = request.evScale ?? 'classic';

  for (const side of [request.attacker, request.defender]) {
    if (!gen.species.get(toID(side.species))) {
      return {
        ok: false,
        error:
          `${side.species} is not in the damage calculator's data yet ` +
          `(likely a Champions-era addition @smogon/calc hasn't shipped). ` +
          `Re-check the spelling, or calc against a comparable Pokemon and treat the result as approximate.`,
        assumptions: [],
      };
    }
  }
  const moveData = gen.moves.get(toID(request.move));
  if (!moveData) {
    return {
      ok: false,
      error: `Move "${request.move}" is not in the damage calculator's data. Re-check the spelling.`,
      assumptions: [],
    };
  }

  const attacker = await resolveSet(request.attacker, 'attacker', evScale, deps);
  const defender = await resolveSet(request.defender, 'defender', evScale, deps);
  const assumptions = [...attacker.assumptions, ...defender.assumptions];

  if (evScale === 'champions') {
    assumptions.push(
      'Champions EV units (0-32) were mapped onto the classic 0-252 scale (x8, capped at 252) for the stat formula; treat very close ranges with caution.',
    );
  }

  const f = request.field ?? {};
  const weather = normalizeFieldName('weather', f.weather);
  const terrain = normalizeFieldName('terrain', f.terrain);
  const fieldError = weather.error ?? terrain.error;
  if (fieldError) return { ok: false, error: fieldError, assumptions };
  const field = new Field({
    gameType: 'Doubles',
    weather: weather.value as never,
    terrain: terrain.value as never,
    attackerSide: { isHelpingHand: f.attackerHelpingHand ?? false } as never,
    defenderSide: {
      isReflect: f.defenderReflect ?? false,
      isLightScreen: f.defenderLightScreen ?? false,
      isAuroraVeil: f.defenderAuroraVeil ?? false,
    } as never,
  });

  try {
    const toCalcPokemon = (set: ResolvedSet) =>
      new Pokemon(gen, set.species, {
        level: set.level,
        item: set.item,
        ability: set.ability,
        nature: set.nature,
        evs: set.evs,
        teraType: set.teraType as never,
        boosts: undefined,
      });
    const attackerMon = toCalcPokemon(attacker.set);
    const defenderMon = toCalcPokemon(defender.set);
    if (request.attacker.boosts) attackerMon.boosts = { ...attackerMon.boosts, ...request.attacker.boosts };
    if (request.defender.boosts) defenderMon.boosts = { ...defenderMon.boosts, ...request.defender.boosts };

    const isSpreadMove = moveData.target === 'allAdjacentFoes' || moveData.target === 'allAdjacent';
    // calculate() re-clones the Move from gen data, so a plain `move.target = ...`
    // mutation is discarded; the override must go through the constructor state.
    const move =
      isSpreadMove && f.singleTarget
        ? new Move(gen, moveData.name, { overrides: { target: 'normal' } as never })
        : new Move(gen, moveData.name);
    if (isSpreadMove && !f.singleTarget) {
      assumptions.push(
        `${moveData.name} is a spread move: doubles spread reduction (0.75x) applied. Pass singleTarget to calc a lone-target hit.`,
      );
    }

    const result = calculate(gen, attackerMon, defenderMon, move, field);
    const [min, max] = result.range();
    const maxHP = defenderMon.maxHP();

    let koChance: string | undefined;
    try {
      koChance = result.kochance().text;
    } catch {
      koChance = undefined;
    }
    let description: string;
    try {
      description = result.fullDesc();
    } catch {
      description = `${attacker.set.species} ${moveData.name} vs. ${defender.set.species}: ${min}-${max}`;
    }

    return {
      ok: true,
      description,
      damage: {
        min,
        max,
        minPercent: Math.round((min / maxHP) * 1000) / 10,
        maxPercent: Math.round((max / maxHP) * 1000) / 10,
      },
      koChance,
      attacker: attacker.set,
      defender: defender.set,
      assumptions,
    };
  } catch (err) {
    return {
      ok: false,
      error: `Damage calc failed: ${err instanceof Error ? err.message : String(err)}`,
      assumptions,
    };
  }
}
