import type { StatsTable } from './types.js';

export interface Spread {
  nature: string;
  evs: StatsTable;
}

/**
 * Parses the "Nature:hp/atk/def/spa/spd/spe" spread strings used by both
 * Pikalytics and Smogon chaos data.
 */
export function parseSpread(raw: string): Spread | undefined {
  const match = raw.trim().match(/^([A-Za-z]+)\s*:\s*(\d+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/);
  if (!match) return undefined;
  const nature = match[1]!;
  return {
    nature: nature.charAt(0).toUpperCase() + nature.slice(1).toLowerCase(),
    evs: {
      hp: Number(match[2]),
      atk: Number(match[3]),
      def: Number(match[4]),
      spa: Number(match[5]),
      spd: Number(match[6]),
      spe: Number(match[7]),
    },
  };
}
