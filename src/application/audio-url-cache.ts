import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface AudioUrlCacheEntry {
  readonly url: string;
  readonly expiresAt: number;
}

const MAX_CACHE_ENTRIES = 500;
const PERSIST_DEBOUNCE_MS = 1_000;

interface SerializedAudioUrlCache {
  readonly entries?: Record<string, AudioUrlCacheEntry>;
}

export class AudioUrlCache {
  readonly #entries = new Map<string, AudioUrlCacheEntry>();
  readonly #filePath: string | undefined;
  #persistTimer: NodeJS.Timeout | undefined;
  #writeChain: Promise<void> = Promise.resolve();

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
    this.#schedulePersist();
  }

  flush(): Promise<void> {
    if (this.#persistTimer !== undefined) {
      clearTimeout(this.#persistTimer);
      this.#persistTimer = undefined;
    }
    return this.#persistNow();
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

  #schedulePersist(): void {
    if (this.#filePath === undefined || this.#persistTimer !== undefined) {
      return;
    }
    const timer = setTimeout(() => {
      this.#persistTimer = undefined;
      void this.#persistNow().catch(() => undefined);
    }, PERSIST_DEBOUNCE_MS);
    timer.unref();
    this.#persistTimer = timer;
  }

  #persistNow(): Promise<void> {
    const filePath = this.#filePath;
    if (filePath === undefined) return Promise.resolve();
    const write = this.#writeChain.then(async () => {
      try {
        await mkdir(dirname(filePath), { recursive: true });
        const temporary = `${filePath}.tmp`;
        await writeFile(
          temporary,
          JSON.stringify({ entries: Object.fromEntries(this.#entries) }),
          "utf8",
        );
        await rename(temporary, filePath);
      } catch {
        // A failing cache file must never break playback.
      }
    });
    this.#writeChain = write;
    return write;
  }
}
