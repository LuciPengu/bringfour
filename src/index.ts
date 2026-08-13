#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { runCalc, type CalcPokemonInput } from './calc.js';
import { KNOWN_FORMATS, resolveFormat, type FormatDef } from './formats.js';
import { parseShowdownPaste } from './paste.js';
import { dataDirsFromProcess } from './paths.js';
import { DataService, GENERIC_ATTRIBUTION } from './sources.js';
import { TeamStore } from './teams.js';
import { analyzeThreats } from './threats.js';

const { teamsDir, cacheDir } = dataDirsFromProcess();
const service = new DataService({ cacheDir });
const teams = new TeamStore(teamsDir);

const server = new McpServer({ name: 'vgc-tools', version: '0.1.0' });

function text(payload: unknown): { content: [{ type: 'text'; text: string }] } {
  return {
    content: [
      { type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) },
    ],
  };
}

function detailFor(format: FormatDef) {
  return async (species: string) => (await service.detail(format, species))?.detail;
}

const formatParam = z
  .string()
  .optional()
  .describe(
    `VGC format. Default: current Champions Reg M-B. Known ids: ${KNOWN_FORMATS.map((f) => f.id).join(', ')}; other Pikalytics/Smogon format ids pass through as-is.`,
  );

const statsShape = {
  hp: z.number().optional(),
  atk: z.number().optional(),
  def: z.number().optional(),
  spa: z.number().optional(),
  spd: z.number().optional(),
  spe: z.number().optional(),
};

const calcPokemonShape = z.object({
  species: z.string(),
  item: z.string().optional().describe('Omit to auto-fill the most common item'),
  ability: z.string().optional(),
  nature: z.string().optional(),
  level: z.number().optional().describe('Default 50'),
  tera_type: z.string().optional().describe('SV formats only'),
  evs: z.object(statsShape).optional().describe('Omit to auto-fill the most common spread'),
  boosts: z.object(statsShape).optional().describe('Stat stages, e.g. {atk: -1} after Intimidate'),
});

function toCalcInput(raw: z.infer<typeof calcPokemonShape>): CalcPokemonInput {
  return {
    species: raw.species,
    item: raw.item,
    ability: raw.ability,
    nature: raw.nature,
    level: raw.level,
    teraType: raw.tera_type,
    evs: raw.evs,
    boosts: raw.boosts,
  };
}

server.registerTool(
  'meta_snapshot',
  {
    title: 'VGC meta snapshot',
    description:
      'Top Pokemon in the current VGC metagame with usage/win rates. Pikalytics primary, Smogon usage stats fallback, cached ~24h.',
    inputSchema: {
      format: formatParam,
      limit: z.number().optional().describe('How many Pokemon to return (default 30)'),
    },
  },
  async ({ format: formatId, limit }) => {
    const format = resolveFormat(formatId);
    const result = await service.metaList(format);
    if (!result) {
      return text(
        `No usage data found for ${format.label} on either Pikalytics or Smogon (tried the last 7 months). ` +
          'Double-check the format id, or the format may be too new for published stats.',
      );
    }
    return text({
      format: format.label,
      source: result.source,
      dataMonth: result.month,
      entries: result.entries.slice(0, limit ?? 30),
      attribution: result.attribution,
    });
  },
);

server.registerTool(
  'pokemon_deep_dive',
  {
    title: 'Pokemon deep-dive',
    description:
      'Common items, abilities, moves, spreads/natures, Tera types (SV), and teammates for one Pokemon in a VGC format.',
    inputSchema: { pokemon: z.string(), format: formatParam },
  },
  async ({ pokemon, format: formatId }) => {
    const format = resolveFormat(formatId);
    const result = await service.detail(format, pokemon);
    if (!result) {
      return text(
        `No usage data for "${pokemon}" in ${format.label}. Check the spelling (use Showdown-style names ` +
          `like "Urshifu-Rapid-Strike"), or it may simply not be used in this format.`,
      );
    }
    const notes: string[] = [];
    if (format.evScale === 'champions') {
      notes.push('EV spreads use Champions units (0-32 per stat).');
      notes.push('Champions uses Mega Evolution, not Tera; Mega formes appear as their own entries (e.g. "Charizard-Mega-Y").');
    }
    return text({ format: format.label, ...result.detail, notes, attribution: result.attribution });
  },
);

server.registerTool(
  'analyze_team',
  {
    title: 'Team threat analysis',
    description:
      'Calc-backed threat report for your team vs the top meta: real OHKO/2HKO threats at common spreads, speed tiers, and speed-control flags. ' +
      'Provide team_paste (Showdown export) or team_name (a saved team).',
    inputSchema: {
      team_paste: z.string().optional(),
      team_name: z.string().optional(),
      format: formatParam,
      top_n: z.number().optional().describe('How many top meta Pokemon to check (default 30)'),
    },
  },
  async ({ team_paste, team_name, format: formatId, top_n }) => {
    const format = resolveFormat(formatId);
    let paste = team_paste;
    if (!paste && team_name) {
      paste = teams.load(team_name);
      if (!paste) {
        const available = teams.list().map((t) => t.name);
        return text(
          `No saved team called "${team_name}". Available: ${available.length ? available.join(', ') : '(none saved yet)'}.`,
        );
      }
    }
    if (!paste) return text('Provide either team_paste (Showdown export) or team_name (a saved team).');

    const team = parseShowdownPaste(paste);
    if (team.length === 0) return text('That paste parsed to zero Pokemon — is it Showdown export format?');

    const meta = await service.metaList(format);
    if (!meta) return text(`No usage data available for ${format.label}, so no threat analysis is possible.`);

    const report = await analyzeThreats(
      team,
      { metaList: meta.entries, topN: top_n ?? 30, evScale: format.evScale },
      { detailFor: detailFor(format) },
    );
    return text({
      format: format.label,
      team: team.map((m) => m.species),
      ...report,
      attribution: meta.attribution,
    });
  },
);

server.registerTool(
  'calc_damage',
  {
    title: 'Damage calculator',
    description:
      'VGC damage calc via @smogon/calc. Unspecified items/abilities/natures/EVs auto-fill from meta data and every assumption is echoed back — override any field and re-call to refine.',
    inputSchema: {
      attacker: calcPokemonShape,
      defender: calcPokemonShape,
      move: z.string(),
      format: formatParam,
      weather: z.string().optional().describe('e.g. Sun, Rain, Sand, Snow'),
      terrain: z.string().optional().describe('e.g. Electric, Grassy, Psychic, Misty'),
      single_target: z.boolean().optional().describe('Skip the doubles spread reduction'),
      helping_hand: z.boolean().optional(),
      reflect: z.boolean().optional(),
      light_screen: z.boolean().optional(),
      aurora_veil: z.boolean().optional(),
    },
  },
  async (args) => {
    const format = resolveFormat(args.format);
    const outcome = await runCalc(
      {
        attacker: toCalcInput(args.attacker),
        defender: toCalcInput(args.defender),
        move: args.move,
        evScale: format.evScale,
        field: {
          weather: args.weather,
          terrain: args.terrain,
          singleTarget: args.single_target,
          attackerHelpingHand: args.helping_hand,
          defenderReflect: args.reflect,
          defenderLightScreen: args.light_screen,
          defenderAuroraVeil: args.aurora_veil,
        },
      },
      { detailFor: detailFor(format) },
    );
    return text({ format: format.label, ...outcome, attribution: GENERIC_ATTRIBUTION });
  },
);

server.registerTool(
  'save_team',
  {
    title: 'Save a team',
    description: 'Save a Showdown-export team paste under a name (stored as plain text in teams/).',
    inputSchema: { name: z.string(), team_paste: z.string() },
  },
  async ({ name, team_paste }) => {
    try {
      return text(teams.save(name, team_paste));
    } catch (err) {
      return text(`Could not save team: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

server.registerTool(
  'list_teams',
  {
    title: 'List saved teams',
    description: 'List saved teams and their Pokemon.',
    inputSchema: {},
  },
  async () => {
    const all = teams.list();
    return text(all.length ? all : 'No teams saved yet. Save one with save_team.');
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
