import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AudioUrlCache } from "../src/application/audio-url-cache.js";

describe("AudioUrlCache", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "rhapsod-cache-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("persists entries to disk and reloads them", async () => {
    const filePath = join(tempDir, "cache.json");
    const cache = AudioUrlCache.load(filePath);

    cache.set("source-a", "https://media.example/a", Date.now() + 60_000);
    await cache.flush();

    const reloaded = AudioUrlCache.load(filePath);
    const entry = reloaded.get("source-a");
    expect(entry?.url).toBe("https://media.example/a");
    expect(entry?.expiresAt).toBeGreaterThan(Date.now());
  });

  it("drops expired entries when loading", () => {
    const filePath = join(tempDir, "cache.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        entries: {
          fresh: {
            url: "https://media.example/fresh",
            expiresAt: Date.now() + 60_000,
          },
          stale: {
            url: "https://media.example/stale",
            expiresAt: Date.now() - 1,
          },
        },
      }),
    );

    const cache = AudioUrlCache.load(filePath);
    expect(cache.get("fresh")).toBeDefined();
    expect(cache.get("stale")).toBeUndefined();
  });

  it("ignores a corrupt cache file", () => {
    const filePath = join(tempDir, "cache.json");
    writeFileSync(filePath, "{not valid json");

    const cache = AudioUrlCache.load(filePath);
    expect(cache.get("anything")).toBeUndefined();
    expect(() =>
      cache.set("x", "https://media.example/x", Date.now() + 1000),
    ).not.toThrow();
  });

  it("keeps the cache bounded", () => {
    const cache = AudioUrlCache.memoryOnly();
    for (let i = 0; i < 2100; i++) {
      cache.set(
        `source-${i}`,
        `https://media.example/${i}`,
        Date.now() + 60_000,
      );
    }
    expect(cache.entries().size).toBe(2000);
    expect(cache.get("source-0")).toBeUndefined();
    expect(cache.get("source-2099")).toBeDefined();
  });

  it("writes a valid JSON file after setting entries", async () => {
    const filePath = join(tempDir, "cache.json");
    const cache = AudioUrlCache.load(filePath);
    cache.set("source-a", "https://media.example/a", Date.now() + 60_000);
    await cache.flush();

    const raw = JSON.parse(readFileSync(filePath, "utf8")) as {
      entries: Record<string, unknown>;
    };
    expect(Object.keys(raw.entries)).toEqual(["source-a"]);
  });
});
