import { describe, expect, it } from 'vitest';
import pikaList from './fixtures/pikalytics-list.fixture.json';
import pikaDetail from './fixtures/pikalytics-detail.fixture.json';
import chaos from './fixtures/chaos.fixture.json';
import {
  normalizeChaosDetail,
  normalizeChaosList,
  normalizePikalyticsDetail,
  normalizePikalyticsList,
} from './normalize.js';

describe('normalizePikalyticsList', () => {
  it('converts string ranks/percents to numbers and keeps order', () => {
    const entries = normalizePikalyticsList(pikaList);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({
      name: 'Garchomp',
      rank: 1,
      winPercent: 49.49,
      games: 21371,
      types: ['dragon', 'ground'],
    });
    expect(entries[0]!.usagePercent).toBeUndefined();
    expect(entries[1]).toMatchObject({ name: 'Sinistcha', rank: 2 });
  });
});

describe('normalizePikalyticsDetail', () => {
  it('normalizes abilities/items/moves/natures with numeric percents', () => {
    const detail = normalizePikalyticsDetail(pikaDetail);
    expect(detail.name).toBe('Garchomp');
    expect(detail.source).toBe('pikalytics');
    expect(detail.baseStats).toEqual({ hp: 108, atk: 130, def: 95, spa: 80, spd: 85, spe: 102 });
    expect(detail.abilities[0]).toEqual({ name: 'Rough Skin', percent: 98.5 });
    expect(detail.items[0]).toEqual({ name: 'Life Orb', percent: 51.5 });
    expect(detail.moves[0]).toEqual({ name: 'Dragon Claw', percent: 89.4 });
    expect(detail.natures[0]).toEqual({ name: 'Jolly', percent: 60.5 });
  });

  it('parses Champions-style spreads (empty nature, slash EVs)', () => {
    const detail = normalizePikalyticsDetail(pikaDetail);
    expect(detail.spreads[0]).toEqual({
      nature: undefined,
      evs: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 },
      percent: 32.7,
    });
  });

  it('falls back to the ranked team list when teammates is null', () => {
    const detail = normalizePikalyticsDetail(pikaDetail);
    expect(detail.teammates.map((t) => t.name)).toEqual(['Whimsicott', 'Charizard']);
    expect(detail.teammates[0]!.percent).toBeUndefined();
    expect(detail.teraTypes).toEqual([]);
  });
});

describe('normalizeChaosList', () => {
  it('sorts by usage descending and expresses usage as 0-100', () => {
    const entries = normalizeChaosList(chaos);
    expect(entries[0]).toMatchObject({ name: 'Kingambit', rank: 1, usagePercent: 45 });
    expect(entries[1]).toMatchObject({ name: 'Garchomp', rank: 2, usagePercent: 40 });
  });
});

describe('normalizeChaosDetail', () => {
  it('maps Showdown ids to display names and weighted counts to percents', () => {
    const detail = normalizeChaosDetail(chaos, 'Garchomp');
    expect(detail).toBeDefined();
    // Total weight = sum of ability weights = 400.
    expect(detail!.source).toBe('smogon');
    expect(detail!.abilities[0]).toEqual({ name: 'Rough Skin', percent: 75 });
    expect(detail!.moves[0]).toEqual({ name: 'Dragon Claw', percent: 87.5 });
    expect(detail!.items[0]).toEqual({ name: 'Life Orb', percent: 50 });
    expect(detail!.teammates[0]).toEqual({ name: 'Kingambit', percent: 60 });
    expect(detail!.usagePercent).toBe(40);
  });

  it('parses spreads, skips unparseable buckets and empty keys', () => {
    const detail = normalizeChaosDetail(chaos, 'Garchomp');
    expect(detail!.spreads[0]).toEqual({
      nature: 'Jolly',
      evs: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 },
      percent: 62.5,
    });
    // "Other" bucket and "" item/move keys are dropped.
    expect(detail!.spreads).toHaveLength(2);
    expect(detail!.items.map((i) => i.name)).not.toContain('');
    expect(detail!.moves.map((m) => m.name)).not.toContain('');
    // Natures are derived from spread natures.
    expect(detail!.natures[0]).toEqual({ name: 'Jolly', percent: 62.5 });
  });

  it('returns undefined for a Pokemon not in the dump', () => {
    expect(normalizeChaosDetail(chaos, 'Mewtwo')).toBeUndefined();
  });

  it('exposes tera types when present', () => {
    const detail = normalizeChaosDetail(chaos, 'Kingambit');
    expect(detail!.teraTypes[0]).toEqual({ name: 'Dark', percent: 60 });
  });
});
