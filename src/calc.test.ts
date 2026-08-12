import { describe, expect, it } from 'vitest';
import { runCalc } from './calc.js';
import type { PokemonDetail } from './types.js';

function detail(partial: Partial<PokemonDetail> & { name: string }): PokemonDetail {
  return {
    source: 'pikalytics',
    abilities: [],
    items: [],
    moves: [],
    natures: [],
    teraTypes: [],
    spreads: [],
    teammates: [],
    ...partial,
  };
}

const flutterMane = detail({
  name: 'Flutter Mane',
  abilities: [{ name: 'Protosynthesis', percent: 99 }],
  items: [{ name: 'Choice Specs', percent: 32 }],
  natures: [{ name: 'Modest', percent: 55 }],
  spreads: [
    { nature: 'Modest', evs: { hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252 }, percent: 40 },
  ],
});

const incineroar = detail({
  name: 'Incineroar',
  abilities: [{ name: 'Intimidate', percent: 98 }],
  items: [{ name: 'Assault Vest', percent: 35 }],
  natures: [{ name: 'Careful', percent: 44 }],
  spreads: [
    { nature: 'Careful', evs: { hp: 252, atk: 4, def: 84, spa: 0, spd: 164, spe: 4 }, percent: 22 },
  ],
});

const details: Record<string, PokemonDetail> = {
  'Flutter Mane': flutterMane,
  Incineroar: incineroar,
};

const detailFor = async (species: string) => details[species];

describe('runCalc', () => {
  it('auto-fills both sides from meta data and echoes assumptions', async () => {
    const result = await runCalc(
      { attacker: { species: 'Flutter Mane' }, defender: { species: 'Incineroar' }, move: 'Moonblast' },
      { detailFor },
    );

    expect(result.ok).toBe(true);
    expect(result.attacker).toMatchObject({
      species: 'Flutter Mane',
      item: 'Choice Specs',
      ability: 'Protosynthesis',
      nature: 'Modest',
      level: 50,
    });
    expect(result.attacker!.evs.spa).toBe(252);
    expect(result.defender).toMatchObject({ item: 'Assault Vest', nature: 'Careful' });
    expect(result.defender!.evs.hp).toBe(252);

    expect(result.damage!.min).toBeGreaterThan(0);
    expect(result.damage!.max).toBeGreaterThanOrEqual(result.damage!.min);
    expect(result.damage!.minPercent).toBeGreaterThan(0);
    expect(result.damage!.maxPercent).toBeGreaterThanOrEqual(result.damage!.minPercent);

    const joined = result.assumptions.join(' ');
    expect(joined).toContain('Choice Specs');
    expect(joined).toContain('Assault Vest');
    expect(result.description).toContain('Flutter Mane');
  });

  it('never overrides explicitly-provided fields', async () => {
    const result = await runCalc(
      {
        attacker: { species: 'Flutter Mane', item: 'Life Orb' },
        defender: { species: 'Incineroar' },
        move: 'Moonblast',
      },
      { detailFor },
    );
    expect(result.attacker!.item).toBe('Life Orb');
    expect(result.assumptions.join(' ')).not.toContain('Choice Specs');
  });

  it('scales Champions EV units (0-32) onto the classic 0-252 scale, and says so', async () => {
    const result = await runCalc(
      {
        attacker: {
          species: 'Garchomp',
          ability: 'Rough Skin',
          nature: 'Jolly',
          evs: { hp: 2, atk: 32, spe: 32 },
        },
        defender: { species: 'Incineroar' },
        move: 'Earthquake',
        evScale: 'champions',
      },
      { detailFor },
    );
    expect(result.ok).toBe(true);
    expect(result.attacker!.evs.atk).toBe(252); // 32*8 capped
    expect(result.attacker!.evs.hp).toBe(16);
    expect(result.assumptions.join(' ')).toMatch(/Champions EV/i);
  });

  it('reports species missing from calc data instead of guessing', async () => {
    const result = await runCalc(
      { attacker: { species: 'Snugglemaw-Mega' }, defender: { species: 'Incineroar' }, move: 'Thunderbolt' },
      { detailFor },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not in the damage calculator's data/i);
    expect(result.error).toContain('Snugglemaw-Mega');
  });

  it('resolves Champions-era Mega formes present in calc data', async () => {
    const result = await runCalc(
      { attacker: { species: 'Raichu-Mega-Y' }, defender: { species: 'Incineroar' }, move: 'Thunderbolt' },
      { detailFor },
    );
    expect(result.ok).toBe(true);
    expect(result.damage!.min).toBeGreaterThan(0);
  });

  it('reports unknown moves', async () => {
    const result = await runCalc(
      { attacker: { species: 'Flutter Mane' }, defender: { species: 'Incineroar' }, move: 'Mega Zap' },
      { detailFor },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Mega Zap');
  });

  it('handles status moves without erroring', async () => {
    const result = await runCalc(
      { attacker: { species: 'Incineroar' }, defender: { species: 'Flutter Mane' }, move: 'Parting Shot' },
      { detailFor },
    );
    expect(result.ok).toBe(true);
    expect(result.damage!.max).toBe(0);
  });

  it('singleTarget actually lifts the doubles spread reduction', async () => {
    const base = {
      attacker: { species: 'Chi-Yu' },
      defender: { species: 'Amoonguss' },
      move: 'Heat Wave',
    };
    const spread = await runCalc(base, { detailFor });
    const single = await runCalc({ ...base, field: { singleTarget: true } }, { detailFor });
    expect(spread.ok).toBe(true);
    expect(single.ok).toBe(true);
    // Spread hit is 0.75x of the single-target hit, so single must be strictly bigger.
    expect(single.damage!.max).toBeGreaterThan(spread.damage!.max);
    expect(spread.assumptions.join(' ')).toContain('spread move');
    expect(single.assumptions.join(' ')).not.toContain('spread move');
  });

  it('normalizes weather aliases instead of silently dropping them', async () => {
    const base = {
      attacker: { species: 'Chi-Yu' },
      defender: { species: 'Amoonguss' },
      move: 'Heat Wave',
    };
    const plain = await runCalc(base, { detailFor });
    const sun = await runCalc({ ...base, field: { weather: 'sun' } }, { detailFor });
    expect(sun.ok).toBe(true);
    expect(sun.damage!.max).toBeGreaterThan(plain.damage!.max);
  });

  it('rejects unknown weather instead of ignoring it', async () => {
    const result = await runCalc(
      {
        attacker: { species: 'Chi-Yu' },
        defender: { species: 'Amoonguss' },
        move: 'Heat Wave',
        field: { weather: 'Monsoon' },
      },
      { detailFor },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Monsoon');
    expect(result.error).toContain('Sun');
  });

  it('falls back to neutral defaults when no meta data exists', async () => {
    const result = await runCalc(
      { attacker: { species: 'Pikachu' }, defender: { species: 'Incineroar' }, move: 'Volt Tackle' },
      { detailFor },
    );
    expect(result.ok).toBe(true);
    expect(result.attacker!.nature).toBe('Serious');
    expect(result.assumptions.join(' ')).toMatch(/no meta data/i);
  });
});
