import { FileCache } from './cache.js';
import type { FormatDef } from './formats.js';
import {
  normalizeChaosDetail,
  normalizeChaosList,
  normalizePikalyticsDetail,
  normalizePikalyticsList,
  type ChaosDump,
} from './normalize.js';
import { toID } from './calc.js';
import type { MetaEntry, PokemonDetail } from './types.js';

const RATINGS = [1760, 1630, 1500, 0];
const MONTHS_BACK = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export const GENERIC_ATTRIBUTION =
  'Data sources: Pikalytics (pikalytics.com, attribution requested) and Smogon usage stats (smogon.com/stats).';

export interface MetaListResult {
  entries: MetaEntry[];
  source: 'pikalytics' | 'smogon';
  month: string;
  rating: number;
  attribution: string;
}

export interface DetailResult {
  detail: PokemonDetail;
  attribution: string;
}

export interface DataServiceOptions {
  /** Fetches a URL and returns parsed JSON; must throw on HTTP errors. */
  fetchJson?: (url: string) => Promise<unknown>;
  cacheDir: string;
  ttlMs?: number;
  now?: () => Date;
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'user-agent': 'vgc-tools-mcp/0.1 (personal teambuilding tool)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function pikalyticsAttribution(month: string, rating: number): string {
  return `Data: Pikalytics (pikalytics.com), month ${month}, rating cutoff ${rating}. Pikalytics asks for attribution when citing these stats.`;
}

function smogonAttribution(format: string, month: string, rating: number): string {
  return `Data: Smogon / Pokemon Showdown usage stats (smogon.com/stats), ${month}, ${format}-${rating} (ladder population).`;
}

interface Slot {
  month: string;
  rating: number;
}

/**
 * Meta-data access with the agreed source policy: Pikalytics primary,
 * Smogon chaos fallback, 24h file cache (plus per-process memos),
 * month-walking discovery since usage dumps trail the current date.
 */
export class DataService {
  private readonly fetchJson: (url: string) => Promise<unknown>;
  private readonly cache: FileCache;
  private readonly now: () => Date;
  /** Formats whose Pikalytics *list* walk already failed this session. */
  private readonly pikalyticsDead = new Set<string>();
  private readonly pikaListMemo = new Map<string, { entries: MetaEntry[]; slot: Slot }>();
  private readonly chaosMemo = new Map<string, { dump: ChaosDump; slot: Slot }>();

  constructor(options: DataServiceOptions) {
    this.fetchJson = options.fetchJson ?? defaultFetchJson;
    this.now = options.now ?? (() => new Date());
    this.cache = new FileCache(options.cacheDir, options.ttlMs ?? DAY_MS, this.now);
  }

  private months(): string[] {
    const out: string[] = [];
    const d = this.now();
    let year = d.getUTCFullYear();
    let month = d.getUTCMonth(); // 0-based
    for (let i = 0; i < MONTHS_BACK; i++) {
      out.push(`${year}-${String(month + 1).padStart(2, '0')}`);
      month--;
      if (month < 0) {
        month = 11;
        year--;
      }
    }
    return out;
  }

  /**
   * Walks month x rating slots (newest first), returning the first payload the
   * validator accepts. Fetch errors and rejected payloads just advance the walk.
   */
  private async walkSlots<T>(
    urlFor: (slot: Slot) => string,
    validate: (data: unknown) => T | undefined,
  ): Promise<{ slot: Slot; value: T } | undefined> {
    for (const month of this.months()) {
      for (const rating of RATINGS) {
        const slot = { month, rating };
        let data: unknown;
        try {
          data = await this.fetchJson(urlFor(slot));
        } catch {
          continue;
        }
        const value = validate(data);
        if (value !== undefined) return { slot, value };
      }
    }
    return undefined;
  }

  // -------------------------------------------------------------------------
  // Pikalytics
  // -------------------------------------------------------------------------

  private pikaListUrl(format: FormatDef, slot: Slot): string {
    return `https://www.pikalytics.com/api/l/${slot.month}/${format.pikalytics}-${slot.rating}`;
  }

  /**
   * Fetches the usage list, which doubles as slot discovery: the (month, rating)
   * that serves it is the one detail lookups reuse. Only a *list* miss may mark
   * the format dead — a missing species never implies a missing format.
   */
  private async pikalyticsList(
    format: FormatDef,
  ): Promise<{ entries: MetaEntry[]; slot: Slot } | undefined> {
    const memo = this.pikaListMemo.get(format.pikalytics);
    if (memo) return memo;

    const cacheKey = `pika-l-${format.pikalytics}`;
    const cached = this.cache.get<{ slot: Slot; data: unknown }>(cacheKey);
    if (cached) {
      const result = { entries: normalizePikalyticsList(cached.data), slot: cached.slot };
      this.pikaListMemo.set(format.pikalytics, result);
      return result;
    }
    if (this.pikalyticsDead.has(format.pikalytics)) return undefined;

    const found = await this.walkSlots(
      (slot) => this.pikaListUrl(format, slot),
      (data) => (Array.isArray(data) && data.length > 0 ? data : undefined),
    );
    if (!found) {
      this.pikalyticsDead.add(format.pikalytics);
      return undefined;
    }
    this.cache.set(cacheKey, { slot: found.slot, data: found.value });
    const result = { entries: normalizePikalyticsList(found.value), slot: found.slot };
    this.pikaListMemo.set(format.pikalytics, result);
    return result;
  }

  private async pikalyticsDetail(
    format: FormatDef,
    species: string,
  ): Promise<{ detail: PokemonDetail; slot: Slot } | undefined> {
    const cacheKey = `pika-p-${format.pikalytics}-${toID(species)}`;
    const cached = this.cache.get<{ slot: Slot; data: unknown }>(cacheKey);
    if (cached) {
      return { detail: normalizePikalyticsDetail(cached.data), slot: cached.slot };
    }

    // Detail lookups only ever use the slot the list discovered; if the list
    // itself has no data, Pikalytics has nothing for this format.
    const slot = (await this.pikalyticsList(format))?.slot;
    if (!slot) return undefined;

    const url =
      `https://www.pikalytics.com/api/p/${slot.month}/` +
      `${format.pikalytics}-${slot.rating}/${encodeURIComponent(species)}`;
    let data: unknown;
    try {
      data = await this.fetchJson(url);
    } catch {
      return undefined;
    }
    if (data && typeof data === 'object' && !Array.isArray(data) && (data as { name?: string }).name) {
      this.cache.set(cacheKey, { slot, data });
      return { detail: normalizePikalyticsDetail(data), slot };
    }
    return undefined;
  }

  // -------------------------------------------------------------------------
  // Smogon chaos
  // -------------------------------------------------------------------------

  private async chaosDump(format: FormatDef): Promise<{ dump: ChaosDump; slot: Slot } | undefined> {
    const memo = this.chaosMemo.get(format.smogon);
    if (memo) return memo;

    const cacheKey = `smogon-chaos-${format.smogon}`;
    const cached = this.cache.get<{ month: string; rating: number; data: ChaosDump }>(cacheKey);
    if (cached) {
      const result = { dump: cached.data, slot: { month: cached.month, rating: cached.rating } };
      this.chaosMemo.set(format.smogon, result);
      return result;
    }

    const found = await this.walkSlots(
      (slot) => `https://www.smogon.com/stats/${slot.month}/chaos/${format.smogon}-${slot.rating}.json`,
      (data) => {
        const dump = data as ChaosDump;
        return dump && typeof dump === 'object' && dump.data && Object.keys(dump.data).length > 0
          ? dump
          : undefined;
      },
    );
    if (!found) return undefined;
    this.cache.set(cacheKey, { month: found.slot.month, rating: found.slot.rating, data: found.value });
    const result = { dump: found.value, slot: found.slot };
    this.chaosMemo.set(format.smogon, result);
    return result;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async metaList(format: FormatDef): Promise<MetaListResult | undefined> {
    const pika = await this.pikalyticsList(format);
    if (pika) {
      return {
        entries: pika.entries,
        source: 'pikalytics',
        month: pika.slot.month,
        rating: pika.slot.rating,
        attribution: pikalyticsAttribution(pika.slot.month, pika.slot.rating),
      };
    }
    const chaos = await this.chaosDump(format);
    if (chaos) {
      return {
        entries: normalizeChaosList(chaos.dump),
        source: 'smogon',
        month: chaos.slot.month,
        rating: chaos.slot.rating,
        attribution: smogonAttribution(format.smogon, chaos.slot.month, chaos.slot.rating),
      };
    }
    return undefined;
  }

  /**
   * Drops every cached artifact for a format (memos, file cache, dead-marking)
   * so the next call refetches — the UI's manual Refresh button.
   */
  refreshFormat(format: FormatDef): void {
    this.pikaListMemo.delete(format.pikalytics);
    this.chaosMemo.delete(format.smogon);
    this.pikalyticsDead.delete(format.pikalytics);
    this.cache.delete(`pika-l-${format.pikalytics}`);
    this.cache.delete(`smogon-chaos-${format.smogon}`);
    // Per-species details embed the slot they were fetched from; a refresh may
    // move the slot, so they must go too.
    this.cache.deleteByPrefix(`pika-p-${format.pikalytics}-`);
  }

  /** Detail plus the attribution of whichever source actually served it. */
  async detail(format: FormatDef, species: string): Promise<DetailResult | undefined> {
    const pika = await this.pikalyticsDetail(format, species);
    if (pika) {
      return {
        detail: pika.detail,
        attribution: pikalyticsAttribution(pika.slot.month, pika.slot.rating),
      };
    }

    const chaos = await this.chaosDump(format);
    if (!chaos) return undefined;
    const attribution = smogonAttribution(format.smogon, chaos.slot.month, chaos.slot.rating);
    const direct = normalizeChaosDetail(chaos.dump, species);
    if (direct) return { detail: direct, attribution };
    // Loose match: chaos keys are Showdown display names; tolerate case/punctuation drift.
    const wanted = toID(species);
    const key = Object.keys(chaos.dump.data).find((k) => toID(k) === wanted);
    const loose = key ? normalizeChaosDetail(chaos.dump, key) : undefined;
    return loose ? { detail: loose, attribution } : undefined;
  }
}
