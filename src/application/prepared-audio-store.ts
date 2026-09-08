import type { Track } from "../domain/track.js";
import type { AudioUrlCache } from "./audio-url-cache.js";
import type {
  AudioUrlSource,
  PrefetchStatus,
} from "../observability/metrics.js";

const AUDIO_URL_EXPIRY_MARGIN_MS = 60_000;
// URLs without an expire parameter (SoundCloud CDN, direct/radio streams)
// are typically valid much longer than YouTube's ~6h signed URLs;
// re-resolving them every 10 minutes was pure waste on repeat plays.
const AUDIO_URL_FALLBACK_TTL_MS = 60 * 60_000;

export function audioUrlExpiresAt(url: string): number {
  try {
    const parsed = new URL(url);
    const queryExpire = Number(parsed.searchParams.get("expire"));
    if (Number.isFinite(queryExpire) && queryExpire > 0) {
      return queryExpire * 1_000 - AUDIO_URL_EXPIRY_MARGIN_MS;
    }
    const pathExpire = Number(/\/expire\/(\d+)/.exec(parsed.pathname)?.[1]);
    if (Number.isFinite(pathExpire) && pathExpire > 0) {
      return pathExpire * 1_000 - AUDIO_URL_EXPIRY_MARGIN_MS;
    }
  } catch {
    // The resolver already validates URLs; use a conservative TTL if parsing fails.
  }
  return Date.now() + AUDIO_URL_FALLBACK_TTL_MS;
}

interface PreparedAudio {
  readonly url: string;
  readonly expiresAt: number;
}

interface PreparedAudioEntry {
  readonly abort?: AbortController;
  readonly promise: Promise<PreparedAudio>;
  expiresAt: number;
  readonly origin: AudioUrlSource;
  status: "pending" | "ready";
}

export interface PreparedAudioResolution {
  readonly url: string;
  readonly audioUrlSource: AudioUrlSource;
  readonly cacheHit: boolean;
  readonly prefetchStatus: PrefetchStatus;
}

/**
 * The playback service's resolved-URL layer: an in-memory map of prepared
 * audio URLs with expiry, in-flight deduplication and per-entry abort,
 * backed by the persistent AudioUrlCache (seeded at construction, written
 * on every successful resolution).
 *
 * Resolution itself stays in YoutubePlaybackService — the store takes a
 * resolve callback so it never needs to know about resolvers — while expiry
 * and persistence live here next to the entries they govern.
 */
export class PreparedAudioStore {
  readonly #prepared = new Map<string, PreparedAudioEntry>();
  readonly #cache: AudioUrlCache | undefined;

  constructor(options: { cache?: AudioUrlCache } = {}) {
    this.#cache = options.cache;
    for (const [source, entry] of this.#cache?.entries() ?? []) {
      this.#prepared.set(source, {
        expiresAt: entry.expiresAt,
        origin: "cache-load",
        promise: Promise.resolve(entry),
        status: "ready",
      });
    }
  }

  /** Peek at an entry's freshness without resolving; for prefetch sweeps. */
  peek(source: string): { readonly expiresAt: number } | undefined {
    return this.#prepared.get(source);
  }

  /** Store a URL that arrived alongside metadata, skipping resolution. */
  setReady(track: Track, url: string): void {
    const expiresAt = audioUrlExpiresAt(url);
    this.#prepared.set(track.source, {
      expiresAt,
      origin: "inline-resolve",
      promise: Promise.resolve({ expiresAt, url }),
      status: "ready",
    });
  }

  /** Persist a resolved URL for restarts; no-op without a cache. */
  persist(source: string, url: string): void {
    this.#cache?.set(source, url, audioUrlExpiresAt(url));
  }

  getOrResolve(
    track: Track,
    origin: AudioUrlSource,
    resolve: (track: Track, signal: AbortSignal) => Promise<string>,
  ): Promise<PreparedAudioResolution> {
    const cached = this.#prepared.get(track.source);
    if (cached) {
      if (cached.expiresAt > Date.now()) {
        const prefetchStatus =
          cached.origin === "prefetch"
            ? cached.status === "pending"
              ? ("in-flight" as const)
              : ("hit" as const)
            : ("not-applicable" as const);
        return cached.promise.then((prepared) => ({
          audioUrlSource: cached.origin,
          cacheHit: true,
          prefetchStatus,
          url: prepared.url,
        }));
      }
      this.invalidate(track.source);
      return this.resolve(track, origin, resolve).then((url) => ({
        audioUrlSource: "inline-resolve" as const,
        cacheHit: false,
        prefetchStatus: "miss" as const,
        url,
      }));
    }
    return this.resolve(track, origin, resolve).then((url) => ({
      audioUrlSource: "inline-resolve" as const,
      cacheHit: false,
      prefetchStatus: "miss" as const,
      url,
    }));
  }

  resolve(
    track: Track,
    origin: AudioUrlSource,
    resolve: (track: Track, signal: AbortSignal) => Promise<string>,
  ): Promise<string> {
    const existing = this.#prepared.get(track.source);
    if (existing !== undefined) {
      return existing.promise.then((prepared) => prepared.url);
    }
    const abort = new AbortController();
    const pending = resolve(track, abort.signal).then((url) => {
      const expiresAt = audioUrlExpiresAt(url);
      const entry = this.#prepared.get(track.source);
      if (entry) entry.expiresAt = expiresAt;
      return { expiresAt, url };
    });
    const entry: PreparedAudioEntry = {
      abort,
      expiresAt: Number.POSITIVE_INFINITY,
      origin,
      promise: pending,
      status: "pending",
    };
    pending.catch(() => {
      if (this.#prepared.get(track.source) === entry) {
        this.#prepared.delete(track.source);
      }
    });
    this.#prepared.set(track.source, entry);
    return pending.then((prepared) => {
      entry.status = "ready";
      return prepared.url;
    });
  }

  /** Abort any in-flight resolution and forget the entry. */
  invalidate(source: string): void {
    this.#prepared.get(source)?.abort?.abort();
    this.#prepared.delete(source);
  }

  /** Forget the entry without aborting; for paths that already settled. */
  drop(source: string): void {
    this.#prepared.delete(source);
  }

  /** Abort everything in flight and forget all entries. */
  invalidateAll(): void {
    for (const entry of this.#prepared.values()) entry.abort?.abort();
    this.#prepared.clear();
  }
}
