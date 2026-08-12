import { describe, expect, it } from 'vitest';
import { parseSpread } from './spread.js';

describe('parseSpread', () => {
  it('parses "Nature:hp/atk/def/spa/spd/spe"', () => {
    expect(parseSpread('Adamant:252/4/0/0/4/252')).toEqual({
      nature: 'Adamant',
      evs: { hp: 252, atk: 4, def: 0, spa: 0, spd: 4, spe: 252 },
    });
  });

  it('tolerates whitespace and lowercase natures', () => {
    expect(parseSpread(' modest : 116/0/140/252/0/0 ')).toEqual({
      nature: 'Modest',
      evs: { hp: 116, atk: 0, def: 140, spa: 252, spd: 0, spe: 0 },
    });
  });

  it('returns undefined for malformed input', () => {
    expect(parseSpread('Other')).toBeUndefined();
    expect(parseSpread('Adamant:252/4/0/0')).toBeUndefined();
    expect(parseSpread('')).toBeUndefined();
  });
});
