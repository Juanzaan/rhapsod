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

  it("round-trips a saved state through the file", async () => {
    const filePath = join(directory, "state.json");
    const store = new FilePlaybackStateStore(filePath);
    store.save({ loopMode: "track", volumePercent: 42 });
    await store.flush();
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

  it("round-trips a queue through the file", async () => {
    const filePath = join(directory, "queue.json");
    const store = new FilePlaybackStateStore(filePath);
    store.save({
      loopMode: "off",
      queue: [
        {
          durationSeconds: 180,
          id: "a",
          requestedBy: "user-1",
          source: "https://www.youtube.com/watch?v=a",
          title: "Track a",
        },
        {
          id: "b",
          requestedBy: "user-2",
          source: "https://www.youtube.com/watch?v=b",
          title: "Track b",
        },
      ],
      volumePercent: 30,
    });
    await store.flush();
    expect(store.load()).toEqual({
      loopMode: "off",
      queue: [
        {
          durationSeconds: 180,
          id: "a",
          requestedBy: "user-1",
          source: "https://www.youtube.com/watch?v=a",
          title: "Track a",
        },
        {
          id: "b",
          requestedBy: "user-2",
          source: "https://www.youtube.com/watch?v=b",
          title: "Track b",
        },
      ],
      volumePercent: 30,
    });
  });

  it("drops invalid queue entries on load", () => {
    const filePath = join(directory, "queue-invalid.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        queue: [
          { id: "ok", requestedBy: "user-1", source: "s", title: "T" },
          { id: "", requestedBy: "user-1", source: "s", title: "T" },
          { id: "no-requester", source: "s", title: "T" },
          "garbage",
          {
            durationSeconds: -5,
            id: "neg",
            requestedBy: "u",
            source: "s",
            title: "T",
          },
        ],
      }),
    );
    const store = new FilePlaybackStateStore(filePath);
    expect(store.load()).toEqual({
      queue: [
        { id: "ok", requestedBy: "user-1", source: "s", title: "T" },
        { id: "neg", requestedBy: "u", source: "s", title: "T" },
      ],
    });
  });

  it("ignores a queue that is not an array", () => {
    const filePath = join(directory, "queue-not-array.json");
    writeFileSync(filePath, JSON.stringify({ queue: "nope" }));
    const store = new FilePlaybackStateStore(filePath);
    expect(store.load()).toEqual({});
  });

  it("creates the parent directory when saving", async () => {
    const nested = join(directory, "nested", "deep", "state.json");
    const store = new FilePlaybackStateStore(nested);
    store.save({ volumePercent: 7 });
    await store.flush();
    expect(store.load()).toEqual({ volumePercent: 7 });
    expect(readFileSync(nested, "utf8")).toBe(
      JSON.stringify({ volumePercent: 7 }),
    );
  });

  it("coalesces rapid saves into a single write", async () => {
    const filePath = join(directory, "coalesced.json");
    const store = new FilePlaybackStateStore(filePath);
    for (let i = 0; i < 20; i++) {
      store.save({ volumePercent: i });
    }
    await store.flush();
    expect(JSON.parse(readFileSync(filePath, "utf8"))).toEqual({
      volumePercent: 19,
    });
  });

  it("surfaces write failures through flush", async () => {
    const filePath = join(directory, "atomic.json");
    mkdirSync(filePath, { recursive: true });
    const store = new FilePlaybackStateStore(filePath);
    store.save({ volumePercent: 3 });
    await expect(store.flush()).rejects.toThrow();
  });
});
