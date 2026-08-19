import { afterAll, describe, expect, it } from "vitest";

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FilePlaybackStateStore } from "../src/domain/state-store.js";

describe("FilePlaybackStateStore", () => {
  const directory = mkdtempSync(join(tmpdir(), "rhapsod-state-"));

  afterAll(() => {
    rmSync(directory, { force: true, recursive: true });
  });

  it("loads an empty state when the file is missing", () => {
    const store = new FilePlaybackStateStore(join(directory, "missing.json"));
    expect(store.load()).toEqual({});
  });

  it("loads an empty state when the file is corrupt", () => {
    const filePath = join(directory, "corrupt.json");
    writeFileSync(filePath, "{ not json");
    const store = new FilePlaybackStateStore(filePath);
    expect(store.load()).toEqual({});
  });

  it("round-trips a saved state through the file", () => {
    const filePath = join(directory, "state.json");
    const store = new FilePlaybackStateStore(filePath);
    store.save({ loopMode: "track", volumePercent: 42 });
    expect(store.load()).toEqual({ loopMode: "track", volumePercent: 42 });
    expect(existsSync(filePath)).toBe(true);
  });

  it("ignores invalid fields on load", () => {
    const filePath = join(directory, "invalid.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        loopMode: "sideways",
        volumePercent: 500,
        extra: "noise",
      }),
    );
    const store = new FilePlaybackStateStore(filePath);
    expect(store.load()).toEqual({});
  });

  it("creates the parent directory when saving", () => {
    const nested = join(directory, "nested", "deep", "state.json");
    const store = new FilePlaybackStateStore(nested);
    store.save({ volumePercent: 7 });
    expect(store.load()).toEqual({ volumePercent: 7 });
    expect(readFileSync(nested, "utf8")).toBe(
      JSON.stringify({ volumePercent: 7 }),
    );
  });

  it("throws when the file cannot be written", () => {
    const filePath = join(directory, "atomic.json");
    mkdirSync(filePath, { recursive: true });
    const store = new FilePlaybackStateStore(filePath);
    expect(() => store.save({ volumePercent: 3 })).toThrow();
  });
});
