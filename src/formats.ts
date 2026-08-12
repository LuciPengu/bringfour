export interface FormatDef {
  id: string;
  label: string;
  /** Pikalytics format slug (their /api/l/{month}/{slug}-{rating} paths). */
  pikalytics: string;
  /** Smogon chaos format id. */
  smogon: string;
  evScale: 'classic' | 'champions';
  teraAllowed: boolean;
  known: boolean;
}

const CHAMPIONS_REG_MB: FormatDef = {
  id: 'champions-reg-mb',
  label: 'Pokemon Champions — Regulation Set M-B (current official format)',
  pikalytics: 'battledataregmbs3',
  smogon: 'gen9championsvgc2026regmb',
  evScale: 'champions',
  teraAllowed: false,
  known: true,
};

const SV_REG_I: FormatDef = {
  id: 'sv-reg-i',
  label: 'Scarlet/Violet — Regulation I (final SV ruleset, historical)',
  pikalytics: 'homebsd',
  smogon: 'gen9vgc2026regi',
  evScale: 'classic',
  teraAllowed: true,
  known: true,
};

export const KNOWN_FORMATS: FormatDef[] = [CHAMPIONS_REG_MB, SV_REG_I];

const ALIASES: Record<string, FormatDef> = {
  'champions-reg-mb': CHAMPIONS_REG_MB,
  champions: CHAMPIONS_REG_MB,
  'reg-mb': CHAMPIONS_REG_MB,
  regmb: CHAMPIONS_REG_MB,
  'sv-reg-i': SV_REG_I,
  sv: SV_REG_I,
  'reg-i': SV_REG_I,
  regi: SV_REG_I,
  gen9vgc2026regi: SV_REG_I,
  gen9championsvgc2026regmb: CHAMPIONS_REG_MB,
  battledataregmbs3: CHAMPIONS_REG_MB,
  homebsd: SV_REG_I,
};

export const DEFAULT_FORMAT = CHAMPIONS_REG_MB;

/**
 * Resolves a user-supplied format string. Unknown ids pass through verbatim to
 * both sources (Champions ids are auto-detected for EV scaling) so adjacent or
 * older formats stay reachable without a registry update.
 */
export function resolveFormat(id?: string): FormatDef {
  if (!id) return DEFAULT_FORMAT;
  const key = id.trim().toLowerCase();
  const known = ALIASES[key];
  if (known) return known;
  return {
    id: key,
    label: `Unrecognized format "${id}" (passed through to data sources as-is)`,
    pikalytics: key,
    smogon: key,
    evScale: key.includes('champions') || key.includes('battledata') ? 'champions' : 'classic',
    teraAllowed: !(key.includes('champions') || key.includes('battledata')),
    known: false,
  };
}
