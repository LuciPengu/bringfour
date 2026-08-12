import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseShowdownPaste } from './paste.js';

function slugify(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) throw new Error(`"${name}" does not make a usable team name.`);
  return slug;
}

/** Plain-text Showdown pastes in a visible teams/ directory, one file per team. */
export class TeamStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  save(name: string, paste: string): { name: string; path: string; species: string[] } {
    const team = parseShowdownPaste(paste);
    if (team.length === 0) {
      throw new Error('That paste parsed to zero Pokemon — is it Showdown export format?');
    }
    const slug = slugify(name);
    const path = join(this.dir, `${slug}.txt`);
    writeFileSync(path, paste.trim() + '\n');
    return { name: slug, path, species: team.map((m) => m.species) };
  }

  delete(name: string): boolean {
    const path = join(this.dir, `${slugify(name)}.txt`);
    try {
      rmSync(path);
      return true;
    } catch {
      return false;
    }
  }

  load(name: string): string | undefined {
    try {
      return readFileSync(join(this.dir, `${slugify(name)}.txt`), 'utf8');
    } catch {
      return undefined;
    }
  }

  list(): { name: string; species: string[] }[] {
    let files: string[];
    try {
      files = readdirSync(this.dir).filter((f) => f.endsWith('.txt'));
    } catch {
      return [];
    }
    return files.map((file) => {
      const name = file.replace(/\.txt$/, '');
      try {
        const team = parseShowdownPaste(readFileSync(join(this.dir, file), 'utf8'));
        return { name, species: team.map((m) => m.species) };
      } catch {
        return { name, species: [] };
      }
    });
  }
}
