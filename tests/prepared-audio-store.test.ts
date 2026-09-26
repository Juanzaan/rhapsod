import { describe, expect, it, vi } from "vitest";

import type { Track } from "../src/domain/track.js";
import { AudioUrlCache } from "../src/application/audio-url-cache.js";
import {
  audioUrlExpiresAt,
  lastsThroughPlay,
  PreparedAudioStore,
} from "../src/application/prepared-audio-store.js";

function track(source: string): Track {
  return { id: `id-${source}`, requestedBy: "user-1", source, title: source };
}

describe("audioUrlExpiresAt", () => {
  it("subtracts the margin from the expire query parameter", () => {
    expect(audioUrlExpiresAt("https://cdn.example/v?expire=2000000000")).toBe(
      2_000_000_000_000 - 60_000,
    );
  });

  it("falls back to an hour TTL without an expire value", () => {
    const before = Date.now();
    const expiresAt = audioUrlExpiresAt("https://media.example/audio");
    expect(expiresAt).toBeGreaterThan(before);
    expect(expiresAt).toBeLessThan(before + 61 * 60_000);
  });
});

describe("lastsThroughPlay", () => {
  const now = 1_000_000;

  it("requires the URL to outlive the whole track", () => {
    const fiveMinutes = { durationSeconds: 300 };
    expect(lastsThroughPlay(now + 120_000, fiveMinutes, 0, now)).toBe(false);
    expect(lastsThroughPlay(now + 301_000, fiveMinutes, 0, now)).toBe(true);
  });

  it("adds the time until the track starts", () => {
    const oneMinute = { durationSeconds: 60 };
    expect(lastsThroughPlay(now + 200_000, oneMinute, 180_000, now)).toBe(
      false,
    );
    expect(lastsThroughPlay(now + 250_000, oneMinute, 180_000, now)).toBe(true);
  });

  it("caps the requirement for very long tracks and ignores live ones", () => {
    const tenHours = { durationSeconds: 10 * 3_600 };
    expect(lastsThroughPlay(now + 5 * 3_600_000, tenHours, 0, now)).toBe(true);
    expect(lastsThroughPlay(now + 1_000, {}, 0, now)).toBe(true);
    expect(lastsThroughPlay(now - 1, {}, 0, now)).toBe(false);
  });
});

describe("PreparedAudioStore", () => {
  it("seeds ready entries from the persistent cache", async () => {
    const cache = AudioUrlCache.memoryOnly();
    cache.set("src:a", "https://media.example/a", Date.now() + 60_000);
    const store = new PreparedAudioStore({ cache });
    const resolve = vi.fn(() => Promise.resolve("https://media.example/fresh"));

    const result = await store.getOrResolve(
      track("src:a"),
      "inline-resolve",
      resolve,
    );

    expect(result).toMatchObject({
      audioUrlSource: "cache-load",
      cacheHit: true,
      prefetchStatus: "not-applicable",
      url: "https://media.example/a",
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("dedupes concurrent resolutions of the same source", async () => {
    const store = new PreparedAudioStore();
    let release!: (url: string) => void;
    const resolve = vi.fn(
      () => new Promise<string>((resolvePromise) => (release = resolvePromise)),
    );

    const first = store.resolve(track("src:a"), "prefetch", resolve);
    const second = store.resolve(track("src:a"), "prefetch", resolve);
    release("https://media.example/a");

    await expect(first).resolves.toBe("https://media.example/a");
    await expect(second).resolves.toBe("https://media.example/a");
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("reports a pending prefetch as in-flight at observation time", async () => {
    // The status reflects the entry state when getOrResolve is called, not
    // when the URL lands: a prefetch still resolving reports "in-flight".
    const store = new PreparedAudioStore();
    let release!: (url: string) => void;
    const resolve = vi.fn(
      () => new Promise<string>((resolvePromise) => (release = resolvePromise)),
    );

    const pending = store.resolve(track("src:a"), "prefetch", resolve);
    const observed = store.getOrResolve(
      track("src:a"),
      "inline-resolve",
      resolve,
    );
    release("https://media.example/a");
    await pending;

    const result = await observed;
    expect(result).toMatchObject({
      cacheHit: true,
      prefetchStatus: "in-flight",
      url: "https://media.example/a",
    });
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("re-resolves expired entries as a miss", async () => {
    const cache = AudioUrlCache.memoryOnly();
    cache.set("src:a", "https://media.example/stale", Date.now() - 1_000);
    const store = new PreparedAudioStore({ cache });
    const resolve = vi.fn(() => Promise.resolve("https://media.example/fresh"));

    const result = await store.getOrResolve(
      track("src:a"),
      "inline-resolve",
      resolve,
    );

    expect(result).toMatchObject({
      audioUrlSource: "inline-resolve",
      cacheHit: false,
      prefetchStatus: "miss",
      url: "https://media.example/fresh",
    });
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("serves setReady URLs without resolving", async () => {
    const store = new PreparedAudioStore();
    const resolve = vi.fn(() => Promise.resolve("https://media.example/fresh"));

    store.setReady(track("src:a"), "https://media.example/inline");
    const result = await store.getOrResolve(
      track("src:a"),
      "inline-resolve",
      resolve,
    );

    expect(result).toMatchObject({
      cacheHit: true,
      url: "https://media.example/inline",
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("invalidate aborts in-flight resolutions and forgets the entry", async () => {
    const store = new PreparedAudioStore();
    const signals: AbortSignal[] = [];
    const resolve = vi.fn(
      (_track: Track, signal: AbortSignal) =>
        new Promise<string>((_, reject) => {
          signals.push(signal);
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );

    const pending = store.resolve(track("src:a"), "prefetch", resolve);
    store.invalidate("src:a");
    await expect(pending).rejects.toThrow("aborted");
    expect(signals[0]?.aborted).toBe(true);

    const resolveFresh = vi.fn(() =>
      Promise.resolve("https://media.example/fresh"),
    );
    await expect(
      store.resolve(track("src:a"), "prefetch", resolveFresh),
    ).resolves.toBe("https://media.example/fresh");
    expect(resolveFresh).toHaveBeenCalledTimes(1);
  });

  it("drop forgets without aborting", async () => {
    const store = new PreparedAudioStore();
    let aborted = false;
    const resolve = vi.fn(
      (_track: Track, signal: AbortSignal) =>
        new Promise<string>(() => {
          signal.addEventListener("abort", () => (aborted = true));
        }),
    );

    void store
      .resolve(track("src:a"), "prefetch", resolve)
      .catch(() => undefined);
    store.drop("src:a");

    expect(aborted).toBe(false);
    const resolveFresh = vi.fn(() =>
      Promise.resolve("https://media.example/fresh"),
    );
    await expect(
      store.resolve(track("src:a"), "prefetch", resolveFresh),
    ).resolves.toBe("https://media.example/fresh");
  });

  it("cleans up failed resolutions so the next call retries", async () => {
    const store = new PreparedAudioStore();
    const failing = vi.fn(() =>
      Promise.reject<string>(new Error("CDN exploded")),
    );
    await expect(
      store.resolve(track("src:a"), "inline-resolve", failing),
    ).rejects.toThrow("CDN exploded");

    const succeeding = vi.fn(() =>
      Promise.resolve("https://media.example/fresh"),
    );
    await expect(
      store.resolve(track("src:a"), "inline-resolve", succeeding),
    ).resolves.toBe("https://media.example/fresh");
    expect(succeeding).toHaveBeenCalledTimes(1);
  });

  it("persists through to the cache on resolve, independently of peek", () => {
    // persist() writes only the persistent cache (restart seeding), never the
    // in-memory map — matching the service behavior this store was split from.
    const cache = AudioUrlCache.memoryOnly();
    const store = new PreparedAudioStore({ cache });

    expect(store.peek("src:a")).toBeUndefined();
    store.persist("src:a", "https://media.example/a?expire=2000000000");
    expect(store.peek("src:a")).toBeUndefined();
    expect(cache.get("src:a")?.url).toBe(
      "https://media.example/a?expire=2000000000",
    );
  });

  it("persists without a cache as a no-op", () => {
    const store = new PreparedAudioStore();
    expect(() =>
      store.persist("src:a", "https://media.example/a"),
    ).not.toThrow();
    store.invalidateAll();
  });

  it("re-resolves a cached URL that would expire during the track", async () => {
    // Regression: a URL with two minutes left was reused for a five-minute
    // track and died with a 403 mid-song.
    const cache = AudioUrlCache.memoryOnly();
    cache.set("src:long", "https://media.example/old", Date.now() + 120_000);
    const store = new PreparedAudioStore({ cache });
    const resolve = vi.fn(() => Promise.resolve("https://media.example/new"));

    const result = await store.getOrResolve(
      { ...track("src:long"), durationSeconds: 300 },
      "inline-resolve",
      resolve,
    );

    expect(resolve).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      cacheHit: false,
      url: "https://media.example/new",
    });
  });

  it("reuses a cached URL that outlives a short track", async () => {
    const cache = AudioUrlCache.memoryOnly();
    cache.set("src:short", "https://media.example/ok", Date.now() + 120_000);
    const store = new PreparedAudioStore({ cache });
    const resolve = vi.fn(() => Promise.resolve("https://media.example/new"));

    const result = await store.getOrResolve(
      { ...track("src:short"), durationSeconds: 60 },
      "inline-resolve",
      resolve,
    );

    expect(resolve).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      cacheHit: true,
      url: "https://media.example/ok",
    });
  });
});
