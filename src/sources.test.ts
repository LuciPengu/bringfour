import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataService } from './sources.js';
import { resolveFormat } from './formats.js';
import pikaList from './fixtures/pikalytics-list.fixture.json';
import pikaDetail from './fixtures/pikalytics-detail.fixture.json';
import chaos from './fixtures/chaos.fixture.json';

describe('resolveFormat', () => {
  it('defaults to Champions Reg M-B', () => {
    expect(resolveFormat().id).toBe('champions-reg-mb');
    expect(resolveFormat().evScale).toBe('champions');
  });

  it('resolves aliases for both known formats', () => {
    expect(resolveFormat('regmb').id).toBe('champions-reg-mb');
    expect(resolveFormat('SV').id).toBe('sv-reg-i');
    expect(resolveFormat('gen9vgc2026regi').evScale).toBe('classic');
  });

  it('passes unknown formats through', () => {
    const f = resolveFormat('gen9vgc2025regh');
    expect(f.known).toBe(false);
    expect(f.smogon).toBe('gen9vgc2025regh');
  });
});

describe('DataService', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vgc-cache-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const format = resolveFormat('champions-reg-mb');
  const now = new Date('2026-08-11T12:00:00Z');

  it('serves the meta list from Pikalytics, walking back to a month that has data', async () => {
    const urls: string[] = [];
    const fetchJson = async (url: string) => {
      urls.push(url);
      // 2026-08 and 2026-07 are empty; 2026-06 has data.
      if (url.includes('/api/l/2026-06/')) return pikaList;
      if (url.includes('pikalytics')) return [];
      throw new Error(`unexpected fetch: ${url}`);
    };

    const service = new DataService({ fetchJson, cacheDir: dir, now: () => now });
    const result = await service.metaList(format);

    expect(result.source).toBe('pikalytics');
    expect(result.month).toBe('2026-06');
    expect(result.entries[0]!.name).toBe('Garchomp');
    expect(result.attribution).toContain('Pikalytics');
    expect(urls.some((u) => u.includes('/api/l/2026-08/'))).toBe(true);
  });

  it('falls back to Smogon chaos when Pikalytics has nothing', async () => {
    const fetchJson = async (url: string) => {
      if (url.includes('pikalytics')) return [];
      if (url.includes('smogon.com/stats/2026-07/chaos/gen9championsvgc2026regmb-1760.json')) {
        return chaos;
      }
      throw new Error(`404: ${url}`);
    };

    const service = new DataService({ fetchJson, cacheDir: dir, now: () => now });
    const result = await service.metaList(format);

    expect(result.source).toBe('smogon');
    expect(result.entries[0]!.name).toBe('Kingambit');
    expect(result.attribution).toContain('Smogon');
  });

  it('caches responses on disk so a second call does not refetch', async () => {
    let calls = 0;
    const fetchJson = async (url: string) => {
      if (url.includes('/api/l/2026-08/')) {
        calls++;
        return pikaList;
      }
      throw new Error(`unexpected fetch: ${url}`);
    };
    const service = new DataService({ fetchJson, cacheDir: dir, now: () => now });
    await service.metaList(format);
    const again = new DataService({ fetchJson, cacheDir: dir, now: () => now });
    await again.metaList(format);
    expect(calls).toBe(1);
  });

  it('serves Pokemon detail from Pikalytics using the slot the list discovered', async () => {
    const fetchJson = async (url: string) => {
      if (url.includes('/api/l/2026-08/')) return pikaList;
      if (url.includes('/api/p/2026-08/') && url.endsWith('/Garchomp')) return pikaDetail;
      if (url.includes('pikalytics')) return [];
      throw new Error(`404: ${url}`);
    };
    const service = new DataService({ fetchJson, cacheDir: dir, now: () => now });
    const result = await service.detail(format, 'Garchomp');
    expect(result!.detail.source).toBe('pikalytics');
    expect(result!.detail.abilities[0]!.name).toBe('Rough Skin');
    expect(result!.attribution).toContain('Pikalytics');
  });

  it('attributes Smogon when the detail actually came from the chaos fallback', async () => {
    const fetchJson = async (url: string) => {
      if (url.includes('/api/l/2026-08/')) return pikaList;
      if (url.includes('/api/p/')) return false; // species not on Pikalytics
      if (url.includes('smogon.com/stats/2026-08/chaos/')) return chaos;
      throw new Error(`404: ${url}`);
    };
    const service = new DataService({ fetchJson, cacheDir: dir, now: () => now });
    const result = await service.detail(format, 'Kingambit');
    expect(result!.detail.source).toBe('smogon');
    expect(result!.attribution).toContain('Smogon');
    expect(result!.attribution).not.toContain('Pikalytics');
  });

  it('does not mark a format dead when only a species is missing', async () => {
    const fetchJson = async (url: string) => {
      if (url.includes('/api/l/2026-08/')) return pikaList;
      if (url.includes('/api/p/')) return false;
      throw new Error(`404: ${url}`);
    };
    const service = new DataService({ fetchJson, cacheDir: dir, now: () => now });
    expect(await service.detail(format, 'Totally Fake Mon')).toBeUndefined();
    // The list (and thus Pikalytics as a source) must still work afterwards.
    const meta = await service.metaList(format);
    expect(meta!.source).toBe('pikalytics');
  });

  it('returns undefined detail when no source knows the Pokemon', async () => {
    const fetchJson = async (url: string) => {
      if (url.includes('smogon.com') && url.includes('2026-07')) return chaos;
      if (url.includes('pikalytics')) return [];
      throw new Error(`404: ${url}`);
    };
    const service = new DataService({ fetchJson, cacheDir: dir, now: () => now });
    expect(await service.detail(format, 'Totally Fake Mon')).toBeUndefined();
  });
});
