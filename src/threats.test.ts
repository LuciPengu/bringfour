import { describe, expect, it } from 'vitest';
import { analyzeThreats, classifyDamage, computeSpeed, detectSpeedControl } from './threats.js';
import { parseShowdownPaste } from './paste.js';
import type { MetaEntry, PokemonDetail } from './types.js';

describe('classifyDamage', () => {
  it('classifies KO tiers from min/max percent', () => {
    expect(classifyDamage(105, 120)).toBe('guaranteed OHKO');
    expect(classifyDamage(92, 108)).toBe('possible OHKO');
    expect(classifyDamage(55, 65)).toBe('guaranteed 2HKO');
    expect(classifyDamage(45, 52)).toBe('possible 2HKO');
    expect(classifyDamage(20, 30)).toBe('3HKO or worse');
  });
});

describe('computeSpeed', () => {
  it('computes level-50 speed stats with the standard formula', () => {
    // Base 60 Spe (Incineroar), 0 EVs, 31 IVs, neutral: floor((2*60+31)*50/100)+5 = 80.
    expect(
      computeSpeed('Incineroar', { nature: 'Careful', evs: { spe: 0 }, level: 50 }),
    ).toBe(80);
    // Base 135 Spe (Flutter Mane), 252 EVs, Timid (+Spe): floor(((2*135+31+63)*50/100+5)*1.1) = 205.
    expect(
      computeSpeed('Flutter Mane', { nature: 'Timid', evs: { spe: 252 }, level: 50 }),
    ).toBe(205);
  });

  it('returns undefined for species missing from calc data', () => {
    expect(computeSpeed('Snugglemaw-Mega', { nature: 'Jolly', evs: {}, level: 50 })).toBeUndefined();
  });
});

describe('detectSpeedControl', () => {
  it('flags common speed-control moves', () => {
    expect(detectSpeedControl(['Moonblast', 'Icy Wind', 'Protect'])).toEqual(['Icy Wind']);
    expect(detectSpeedControl(['Tailwind', 'Trick Room'])).toEqual(['Tailwind', 'Trick Room']);
    expect(detectSpeedControl(['Flare Blitz'])).toEqual([]);
  });
});

describe('analyzeThreats', () => {
  const myTeam = parseShowdownPaste(`Incineroar @ Safety Goggles
Ability: Intimidate
Level: 50
EVs: 252 HP / 4 Atk / 252 SpD
Careful Nature
- Fake Out
- Knock Off

Whimsicott @ Focus Sash
Ability: Prankster
Level: 50
EVs: 4 HP / 252 SpA / 252 Spe
Timid Nature
- Tailwind
- Moonblast`);

  const metaList: MetaEntry[] = [
    { name: 'Flutter Mane', rank: 1, usagePercent: 40 },
    { name: 'Mystery Mon', rank: 2, usagePercent: 30 },
  ];

  const flutterDetail: PokemonDetail = {
    name: 'Flutter Mane',
    source: 'smogon',
    abilities: [{ name: 'Protosynthesis', percent: 99 }],
    items: [{ name: 'Choice Specs', percent: 40 }],
    moves: [
      { name: 'Moonblast', percent: 95 },
      { name: 'Shadow Ball', percent: 80 },
      { name: 'Icy Wind', percent: 40 },
      { name: 'Protect', percent: 30 },
    ],
    natures: [{ name: 'Timid', percent: 60 }],
    teraTypes: [],
    spreads: [
      { nature: 'Timid', evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 }, percent: 45 },
    ],
    teammates: [],
  };

  const detailFor = async (species: string) =>
    species === 'Flutter Mane' ? flutterDetail : undefined;

  it('runs real calcs against my spreads and reports the best move per member', async () => {
    const report = await analyzeThreats(myTeam, { metaList, topN: 2 }, { detailFor });

    expect(report.threats).toHaveLength(1);
    const threat = report.threats[0]!;
    expect(threat.name).toBe('Flutter Mane');
    expect(threat.set.item).toBe('Choice Specs');

    const vsIncin = threat.vs.find((v) => v.member === 'Incineroar')!;
    // Status moves are never the "best move".
    expect(['Moonblast', 'Shadow Ball', 'Icy Wind']).toContain(vsIncin.bestMove);
    expect(vsIncin.maxPercent).toBeGreaterThan(0);
    expect(vsIncin.category).toBeDefined();

    // STAB Specs Moonblast into 4 HP Whimsicott (~118-139%) is a guaranteed OHKO.
    const vsWhims = threat.vs.find((v) => v.member === 'Whimsicott')!;
    expect(vsWhims.bestMove).toBe('Moonblast');
    expect(vsWhims.minPercent).toBeGreaterThan(100);
    expect(vsWhims.category).toBe('guaranteed OHKO');
  });

  it('reports speed relations and speed control', async () => {
    const report = await analyzeThreats(myTeam, { metaList, topN: 2 }, { detailFor });
    const threat = report.threats[0]!;
    // 252 Timid Flutter Mane (205) outspeeds Incineroar (80) but ties are not "outspeeds".
    expect(threat.speed.stat).toBe(205);
    expect(threat.speed.outspeeds).toContain('Incineroar');
    expect(threat.speed.speedControl).toEqual(['Icy Wind']);
  });

  it('summarizes team speed and flags my own speed control', async () => {
    const report = await analyzeThreats(myTeam, { metaList, topN: 2 }, { detailFor });
    expect(report.teamSpeed.hasTailwind).toBe(true);
    expect(report.teamSpeed.hasTrickRoom).toBe(false);
    expect(report.speedTiers.filter((t) => t.side === 'team')).toHaveLength(2);
    expect(report.speedTiers[0]!.speed).toBeGreaterThanOrEqual(report.speedTiers.at(-1)!.speed);
  });

  it('lists meta mons without data as skipped instead of silently dropping them', async () => {
    const report = await analyzeThreats(myTeam, { metaList, topN: 2 }, { detailFor });
    expect(report.skipped).toEqual([{ name: 'Mystery Mon', reason: 'no meta detail available' }]);
  });

  it('scales Champions EV units on both sides when asked', async () => {
    const champTeam = parseShowdownPaste(`Garchomp @ Life Orb
Ability: Rough Skin
Level: 50
EVs: 2 HP / 32 Atk / 32 Spe
Jolly Nature
- Earthquake`);
    const champMeta: MetaEntry[] = [{ name: 'Kingambit', rank: 1 }];
    const kingambitDetail: PokemonDetail = {
      ...flutterDetail,
      name: 'Kingambit',
      abilities: [{ name: 'Defiant', percent: 99 }],
      items: [{ name: 'Black Glasses', percent: 50 }],
      moves: [{ name: 'Kowtow Cleave', percent: 90 }],
      natures: [{ name: 'Adamant', percent: 80 }],
      spreads: [
        { nature: undefined, evs: { hp: 32, atk: 32, def: 0, spa: 0, spd: 2, spe: 0 }, percent: 60 },
      ],
    };
    const report = await analyzeThreats(
      champTeam,
      { metaList: champMeta, topN: 1, evScale: 'champions' },
      { detailFor: async (s) => (s === 'Kingambit' ? kingambitDetail : undefined) },
    );
    const threat = report.threats[0]!;
    // 32-unit EVs scale to 252; nature falls back to the natures table.
    expect(threat.set.evs.atk).toBe(252);
    expect(threat.set.nature).toBe('Adamant');
    expect(report.assumptions.join(' ')).toMatch(/Champions EV/i);
  });
});
