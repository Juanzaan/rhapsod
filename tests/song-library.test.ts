import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SongLibrary } from "../src/application/song-library.js";

const tempDirs: string[] = [];

function makeTempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "rhapsod-library-"));
  tempDirs.push(dir);
  return join(dir, "song-library.json");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0))
    rmSync(dir, { force: true, recursive: true });
});

describe("SongLibrary", () => {
  it("records new songs and dedupes re-hears by id", async () => {
    const library = new SongLibrary(makeTempFile());

    library.record({
      artist: "Duki",
      id: "abc123",
      source: "https://www.youtube.com/watch?v=abc123",
      title: "Duki - Rockstar",
    });
    library.record({ id: "abc123", title: "Duki - Rockstar" });
    await library.flush();

    expect(library.size()).toBe(1);
    const entry = library.get("abc123");
    expect(entry).toMatchObject({
      artist: "Duki",
      plays: 2,
      title: "Duki - Rockstar",
    });
    expect(entry?.firstHeardAt).toBeLessThanOrEqual(entry?.lastHeardAt ?? 0);
  });

  it("returns undefined for unknown ids and caps recent listings", async () => {
    const library = new SongLibrary(makeTempFile());

    expect(library.get("nope")).toBeUndefined();
    library.record({ id: "a", title: "A" });
    library.record({ id: "b", title: "B" });
    await library.flush();

    expect(library.recent(1)).toHaveLength(1);
    expect(library.recent(10)).toHaveLength(2);
  });

  it("persists across restarts", async () => {
    const file = makeTempFile();
    const original = new SongLibrary(file);
    original.record({ artist: "Duki", id: "a", title: "Duki - Rockstar" });
    await original.flush();

    const reloaded = new SongLibrary(file);
    expect(reloaded.size()).toBe(1);
    expect(reloaded.get("a")).toMatchObject({
      artist: "Duki",
      plays: 1,
      title: "Duki - Rockstar",
    });
  });

  it("starts fresh on corrupt files", () => {
    const badFile = makeTempFile();
    writeFileSync(badFile, "{not json", "utf8");

    const library = new SongLibrary(badFile);
    expect(library.size()).toBe(0);
    expect(library.recent(5)).toEqual([]);
  });

  it("never prunes: the archive only grows", async () => {
    const file = makeTempFile();
    const tracks: Record<string, unknown> = {};
    for (let index = 0; index < 300; index++) {
      tracks[`t${index}`] = {
        completes: 0,
        firstHeardAt: Date.now() + index,
        lastHeardAt: Date.now() + index,
        plays: 1,
        skips: 0,
        title: `Artist - Track ${index}`,
      };
    }
    writeFileSync(file, JSON.stringify({ tracks, version: 1 }), "utf8");
    const library = new SongLibrary(file);

    library.record({ id: "new", title: "Artist - New" });
    await library.flush();

    expect(library.size()).toBe(301);
    expect(library.recent(500)).toHaveLength(301);
  });
});
