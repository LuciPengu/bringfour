import { describe, expect, it } from 'vitest';
import { resolveDataDirs } from './paths.js';

const base = {
  env: {} as Record<string, string | undefined>,
  cwd: '/work/project',
  home: '/Users/me',
  exists: () => false,
};

describe('resolveDataDirs', () => {
  it('falls back to ~/.vgc-tools when cwd has no teams dir', () => {
    expect(resolveDataDirs(base)).toEqual({
      teamsDir: '/Users/me/.vgc-tools/teams',
      cacheDir: '/Users/me/.vgc-tools/cache',
    });
  });

  it('uses project-local dirs when <cwd>/teams exists', () => {
    const dirs = resolveDataDirs({ ...base, exists: (p) => p === '/work/project/teams' });
    expect(dirs).toEqual({
      teamsDir: '/work/project/teams',
      cacheDir: '/work/project/.cache',
    });
  });

  it('VGC_TOOLS_HOME overrides both project mode and the home fallback', () => {
    const dirs = resolveDataDirs({
      ...base,
      env: { VGC_TOOLS_HOME: '/data/vgc' },
      exists: (p) => p === '/work/project/teams',
    });
    expect(dirs).toEqual({ teamsDir: '/data/vgc/teams', cacheDir: '/data/vgc/cache' });
  });

  it('per-dir env vars beat VGC_TOOLS_HOME', () => {
    const dirs = resolveDataDirs({
      ...base,
      env: { VGC_TOOLS_HOME: '/data/vgc', VGC_TEAMS_DIR: '/teams/here', VGC_CACHE_DIR: '/tmp/vgc-cache' },
    });
    expect(dirs).toEqual({ teamsDir: '/teams/here', cacheDir: '/tmp/vgc-cache' });
  });

  it('a single per-dir override leaves the other dir on the normal chain', () => {
    const dirs = resolveDataDirs({ ...base, env: { VGC_TEAMS_DIR: '/teams/here' } });
    expect(dirs).toEqual({ teamsDir: '/teams/here', cacheDir: '/Users/me/.vgc-tools/cache' });
  });
});
