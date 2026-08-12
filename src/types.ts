export interface StatsTable {
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
}

/** One row of a usage/meta listing, normalized across sources. */
export interface MetaEntry {
  name: string;
  rank: number;
  /** Share of teams the Pokemon appears on, 0-100. Absent for sources that only rank. */
  usagePercent?: number;
  winPercent?: number;
  games?: number;
  types?: string[];
}

/** A named option (item, move, ability, ...) with its observed share, 0-100. */
export interface RankedShare {
  name: string;
  /** Absent when the source ranks without percentages (e.g. Pikalytics teammates). */
  percent?: number;
}

export interface SpreadShare {
  /** Absent when the source doesn't attach natures to spreads (Champions in-game data). */
  nature?: string;
  evs: StatsTable;
  percent: number;
}

/** Full per-Pokemon usage detail, normalized across Pikalytics and Smogon chaos. */
export interface PokemonDetail {
  name: string;
  source: 'pikalytics' | 'smogon';
  types?: string[];
  baseStats?: StatsTable;
  rank?: number;
  winPercent?: number;
  usagePercent?: number;
  abilities: RankedShare[];
  items: RankedShare[];
  moves: RankedShare[];
  natures: RankedShare[];
  teraTypes: RankedShare[];
  spreads: SpreadShare[];
  teammates: RankedShare[];
}

export interface TeamMember {
  /** Nickname, if the paste had one. */
  name?: string;
  species: string;
  gender?: 'M' | 'F';
  item?: string;
  ability?: string;
  level: number;
  teraType?: string;
  nature?: string;
  evs: StatsTable;
  ivs: StatsTable;
  moves: string[];
}
