import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Small file-backed cache: one JSON file per key, expired by TTL. */
export class FileCache {
  constructor(
    private readonly dir: string,
    private readonly ttlMs: number,
    private readonly now: () => Date = () => new Date(),
  ) {
    mkdirSync(dir, { recursive: true });
  }

  private pathFor(key: string): string {
    return join(this.dir, `${key.toLowerCase().replace(/[^a-z0-9._-]/gi, '_')}.json`);
  }

  get<T>(key: string): T | undefined {
    try {
      const raw = JSON.parse(readFileSync(this.pathFor(key), 'utf8')) as {
        savedAt: string;
        value: T;
      };
      const age = this.now().getTime() - new Date(raw.savedAt).getTime();
      if (age < 0 || age > this.ttlMs) return undefined;
      return raw.value;
    } catch {
      return undefined;
    }
  }

  set(key: string, value: unknown): void {
    writeFileSync(this.pathFor(key), JSON.stringify({ savedAt: this.now().toISOString(), value }));
  }
}
