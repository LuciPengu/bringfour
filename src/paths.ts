import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface PathProbe {
  env: Record<string, string | undefined>;
  cwd: string;
  home: string;
  exists: (path: string) => boolean;
}

export interface DataDirs {
  teamsDir: string;
  cacheDir: string;
}

/**
 * Where teams and the usage-data cache live.
 *
 * Running from a checkout (or any directory with a teams/ folder) keeps
 * everything project-local, as before. Running via npx/global install — where
 * cwd may be unwritable (Claude Desktop launches servers from /) — lands in
 * ~/.vgc-tools instead of scribbling inside the npx cache.
 */
export function resolveDataDirs(probe: PathProbe): DataDirs {
  const { env, cwd, home, exists } = probe;

  const toolsHome = env.VGC_TOOLS_HOME;
  let teamsDir: string;
  let cacheDir: string;

  if (toolsHome) {
    teamsDir = join(toolsHome, 'teams');
    cacheDir = join(toolsHome, 'cache');
  } else if (exists(join(cwd, 'teams'))) {
    teamsDir = join(cwd, 'teams');
    cacheDir = join(cwd, '.cache');
  } else {
    teamsDir = join(home, '.vgc-tools', 'teams');
    cacheDir = join(home, '.vgc-tools', 'cache');
  }

  if (env.VGC_TEAMS_DIR) teamsDir = env.VGC_TEAMS_DIR;
  if (env.VGC_CACHE_DIR) cacheDir = env.VGC_CACHE_DIR;

  return { teamsDir, cacheDir };
}

export function dataDirsFromProcess(): DataDirs {
  return resolveDataDirs({
    env: process.env,
    cwd: process.cwd(),
    home: homedir(),
    exists: existsSync,
  });
}
