import type { StatsTable, TeamMember } from './types.js';

const STAT_KEYS: Record<string, keyof StatsTable> = {
  hp: 'hp',
  atk: 'atk',
  def: 'def',
  spa: 'spa',
  spd: 'spd',
  spe: 'spe',
};

function emptyStats(fill: number): StatsTable {
  return { hp: fill, atk: fill, def: fill, spa: fill, spd: fill, spe: fill };
}

function parseStatLine(line: string, fill: number): StatsTable {
  const stats = emptyStats(fill);
  for (const part of line.split('/')) {
    const match = part.trim().match(/^(\d+)\s+(HP|Atk|Def|SpA|SpD|Spe)$/i);
    if (!match) continue;
    const key = STAT_KEYS[match[2]!.toLowerCase()];
    if (key) stats[key] = Number(match[1]);
  }
  return stats;
}

/**
 * Header shapes Showdown exports:
 *   "Incineroar @ Safety Goggles"
 *   "Cinder (Incineroar) (M) @ Safety Goggles"
 *   "Urshifu-Rapid-Strike"
 */
function parseHeader(line: string): Pick<TeamMember, 'name' | 'species' | 'gender' | 'item'> {
  let rest = line;
  let item: string | undefined;
  const atIndex = rest.indexOf(' @ ');
  if (atIndex !== -1) {
    item = rest.slice(atIndex + 3).trim() || undefined;
    rest = rest.slice(0, atIndex);
  }
  rest = rest.trim();

  let gender: 'M' | 'F' | undefined;
  const genderMatch = rest.match(/\s\((M|F)\)$/);
  if (genderMatch) {
    gender = genderMatch[1] as 'M' | 'F';
    rest = rest.slice(0, genderMatch.index).trim();
  }

  let name: string | undefined;
  let species = rest;
  const nickMatch = rest.match(/^(.*)\s\(([^()]+)\)$/);
  if (nickMatch) {
    name = nickMatch[1]!.trim();
    species = nickMatch[2]!.trim();
  }

  return { name, species, gender, item };
}

/** Parses Showdown teambuilder export format into structured team members. */
export function parseShowdownPaste(paste: string): TeamMember[] {
  const blocks = paste
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  const team: TeamMember[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    const headerLine = lines.shift();
    if (!headerLine) continue;

    const mon: TeamMember = {
      ...parseHeader(headerLine),
      level: 50,
      evs: emptyStats(0),
      ivs: emptyStats(31),
      moves: [],
    };

    for (const line of lines) {
      if (line.startsWith('- ')) {
        mon.moves.push(line.slice(2).trim());
        continue;
      }
      const [rawKey, ...restParts] = line.split(':');
      const value = restParts.join(':').trim();
      switch (rawKey!.trim().toLowerCase()) {
        case 'ability':
          mon.ability = value;
          break;
        case 'level':
          mon.level = Number(value) || 50;
          break;
        case 'tera type':
          mon.teraType = value;
          break;
        case 'evs':
          mon.evs = parseStatLine(value, 0);
          break;
        case 'ivs':
          mon.ivs = parseStatLine(value, 31);
          break;
        default: {
          const natureMatch = line.match(/^([A-Za-z]+)\s+Nature$/i);
          if (natureMatch) mon.nature = natureMatch[1];
          break;
        }
      }
    }

    team.push(mon);
  }
  return team;
}
