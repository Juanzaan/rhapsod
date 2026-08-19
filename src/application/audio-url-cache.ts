import { existsSync, readFileSync, writeFileSync } from "node:fs";

export interface AudioUrlCacheEntry {
  readonly url: string;
  readonly expiresAt: number;
}

const MAX_CACHE_ENTRIES = 500;

interface SerializedAudioUrlCache {
  readonly entries?: Record<string, AudioUrlCacheEntry>;
}

export class AudioUrlCache {
  readonly #entries = new Map<string, AudioUrlCacheEntry>();
  readonly #filePath: string | undefined;

  private constructor(filePath: string | undefined) {
    this.#filePath = filePath;
  }

  static load(filePath: string): AudioUrlCache {
    const cache = new AudioUrlCache(filePath);
    if (existsSync(filePath)) {
      try {
        const parsed = JSON.parse(
          readFileSync(filePath, "utf8"),
        ) as SerializedAudioUrlCache;
        const now = Date.now();
        for (const [source, entry] of Object.entries(parsed.entries ?? {})) {
          if (
            entry &&
            typeof entry.url === "string" &&
            typeof entry.expiresAt === "number" &&
            entry.expiresAt > now
          ) {
            cache.#entries.set(source, {
              url: entry.url,
              expiresAt: entry.expiresAt,
            });
          }
        }
      } catch {
        // A corrupt cache file must never break startup.
      }
    }
    return cache;
  }

  static memoryOnly(): AudioUrlCache {
    return new AudioUrlCache(undefined);
  }

  entries(): ReadonlyMap<string, AudioUrlCacheEntry> {
    return this.#entries;
  }

  get(source: string): AudioUrlCacheEntry | undefined {
    const entry = this.#entries.get(source);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.#entries.delete(source);
      return undefined;
    }
    return entry;
  }

  set(source: string, url: string, expiresAt: number): void {
    this.#entries.set(source, { url, expiresAt });
    this.#prune();
    this.#persist();
  }

  #prune(): void {
    const now = Date.now();
    for (const [source, entry] of this.#entries) {
      if (entry.expiresAt <= now) {
        this.#entries.delete(source);
      }
    }
    while (this.#entries.size > MAX_CACHE_ENTRIES) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
  }

  #persist(): void {
    if (this.#filePath === undefined) return;
    try {
      writeFileSync(
        this.#filePath,
        JSON.stringify({ entries: Object.fromEntries(this.#entries) }),
        "utf8",
      );
    } catch {
      // A failing cache file must never break playback.
    }
  }
}
