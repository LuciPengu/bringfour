import { describe, expect, it } from 'vitest';
import { parseShowdownPaste } from './paste.js';

describe('parseShowdownPaste', () => {
  it('parses a standard VGC set', () => {
    const paste = `Incineroar @ Safety Goggles
Ability: Intimidate
Level: 50
Tera Type: Grass
EVs: 252 HP / 4 Atk / 92 Def / 76 SpD / 84 Spe
Impish Nature
- Fake Out
- Knock Off
- Parting Shot
- U-turn`;

    const team = parseShowdownPaste(paste);
    expect(team).toHaveLength(1);
    const mon = team[0]!;
    expect(mon.species).toBe('Incineroar');
    expect(mon.item).toBe('Safety Goggles');
    expect(mon.ability).toBe('Intimidate');
    expect(mon.level).toBe(50);
    expect(mon.teraType).toBe('Grass');
    expect(mon.nature).toBe('Impish');
    expect(mon.evs).toEqual({ hp: 252, atk: 4, def: 92, spa: 0, spd: 76, spe: 84 });
    expect(mon.ivs).toEqual({ hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 });
    expect(mon.moves).toEqual(['Fake Out', 'Knock Off', 'Parting Shot', 'U-turn']);
  });

  it('parses nickname, gender, partial IVs, and multiple mons', () => {
    const paste = `Cinder (Incineroar) (M) @ Assault Vest
Ability: Intimidate
EVs: 252 HP / 252 Atk / 4 SpD
Adamant Nature
IVs: 0 SpA
- Flare Blitz

Flutter Mane @ Booster Energy
Ability: Protosynthesis
Level: 50
EVs: 116 HP / 140 Def / 252 SpA
Modest Nature
IVs: 0 Atk
- Moonblast
- Shadow Ball`;

    const team = parseShowdownPaste(paste);
    expect(team).toHaveLength(2);

    const incin = team[0]!;
    expect(incin.name).toBe('Cinder');
    expect(incin.species).toBe('Incineroar');
    expect(incin.gender).toBe('M');
    expect(incin.item).toBe('Assault Vest');
    expect(incin.level).toBe(50); // VGC default when omitted
    expect(incin.ivs).toEqual({ hp: 31, atk: 31, def: 31, spa: 0, spd: 31, spe: 31 });

    const flutter = team[1]!;
    expect(flutter.species).toBe('Flutter Mane');
    expect(flutter.name).toBeUndefined();
    expect(flutter.evs.spa).toBe(252);
    expect(flutter.ivs.atk).toBe(0);
    expect(flutter.moves).toEqual(['Moonblast', 'Shadow Ball']);
  });

  it('handles forme names with hyphens and no item', () => {
    const paste = `Urshifu-Rapid-Strike
Ability: Unseen Fist
- Surging Strikes`;
    const team = parseShowdownPaste(paste);
    expect(team[0]!.species).toBe('Urshifu-Rapid-Strike');
    expect(team[0]!.item).toBeUndefined();
  });
});
