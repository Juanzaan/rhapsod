import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ListeningHistory } from "../src/application/listening-history.js";

const tempDirs: string[] = [];

function makeTempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "rhapsod-history-"));
  tempDirs.push(dir);
  return join(dir, "listening-history.json");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0))
    rmSync(dir, { force: true, recursive: true });
});

describe("ListeningHistory autoplay DJ signals", () => {
  it("keeps autoplay picks out of channel plays but counts skips on them", () => {
    const history = new ListeningHistory(makeTempFile());
    const pick = { id: "pickpickpiK", title: "Artist - Autoplay Pick" };
    history.recordStart("autoplay", pick);
    history.recordFinish("autoplay", pick, true);
    // Nobody asked for it: no plays, no completes, not in !tops.
    expect(history.topTracks(10)).toEqual([]);
    expect(history.artistScores().get("artist") ?? 0).toBe(0);
    expect(history.hasHeard(pick.id)).toBe(true);

    history.recordStart("autoplay", pick);
    history.recordFinish("autoplay", pick, false);
    history.recordStart("uid-1", pick);
    // A person skipping it and a person requesting it both register.
    expect(history.topTracks(10)).toMatchObject([{ plays: 1, skips: 1 }]);
  });

  it("returns rested, rarely skipped favorites ranked by completions", () => {
    vi.useFakeTimers();
    try {
      const history = new ListeningHistory(makeTempFile());
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const loved = { id: "lovedlovedL", title: "Soda - Loved" };
      const requested = { id: "requestedrQ", title: "Band - Requested" };
      const skipped = { id: "skippedskiP", title: "Band - Skipped" };
      for (let i = 0; i < 3; i++) {
        history.recordStart("uid-1", loved);
        history.recordFinish("uid-1", loved, true);
        history.recordStart("uid-2", requested);
        history.recordStart("uid-2", skipped);
        history.recordFinish("uid-2", skipped, false);
      }
      history.recordStart("uid-1", { id: "deadbeef1234", title: "Direct" });
      vi.setSystemTime(new Date("2026-01-01T07:00:00Z"));
      history.recordStart("uid-1", { id: "freshfreshF", title: "X - Fresh" });

      const ids = history.classicSeeds(10).map((seed) => seed.id);
      // The fresh track is still resting; skip-heavy and non-YouTube tracks
      // never come back; completions outrank bare requests.
      expect(ids).toEqual(["lovedlovedL", "requestedrQ"]);
      expect(
        history.classicSeeds(10, Date.parse("2026-01-01T13:00:00Z")),
      ).toHaveLength(3);
      expect(history.classicSeeds(1)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("seeds discovery from the most played artists with their best track", () => {
    const history = new ListeningHistory(makeTempFile());
    const hit = { id: "sodahitsodA", title: "Soda Stereo - Hit" };
    const deep = { id: "sodadeepsoD", title: "Soda Stereo - Deep Cut" };
    history.recordStart("uid-1", hit);
    history.recordFinish("uid-1", hit, true);
    history.recordStart("uid-1", deep);
    history.recordStart("uid-1", deep);
    history.recordStart("uid-1", { id: "onceonceonC", title: "Other - Once" });
    history.recordStart("autoplay", { id: "autoautoauT", title: "Bot - Pick" });

    const seeds = history.channelArtistSeeds(5);
    expect(seeds.map((seed) => seed.artist)).toEqual(["Soda Stereo", "Other"]);
    // The artist seed is the track the channel actually finished.
    expect(seeds[0]?.id).toBe("sodahitsodA");
  });

  it("removes autoplay's own plays from a version 1 store exactly once", async () => {
    const file = makeTempFile();
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        global: {
          sharedsharE: {
            artist: "A",
            title: "A - Shared",
            plays: 5,
            completes: 4,
            skips: 0,
            lastPlayedAt: 1,
          },
        },
        users: {
          autoplay: {
            plays: [{ at: 1, completed: true, id: "sharedsharE" }],
            tracks: {
              sharedsharE: {
                title: "A - Shared",
                plays: 3,
                completes: 3,
                skips: 0,
                lastPlayedAt: 1,
              },
            },
          },
        },
      }),
    );
    const upgraded = new ListeningHistory(file);
    expect(upgraded.topTracks(1)).toMatchObject([{ plays: 2, completes: 1 }]);
    upgraded.recordStart("uid-1", { id: "otherothrO", title: "B - Other" });
    await upgraded.flush();
    const stored = JSON.parse(readFileSync(file, "utf8")) as {
      version: number;
    };
    expect(stored.version).toBe(2);

    const reloaded = new ListeningHistory(file);
    expect(
      reloaded.topTracks(5).find((entry) => entry.title === "A - Shared"),
    ).toMatchObject({ plays: 2, completes: 1 });
  });
});

describe("ListeningHistory", () => {
  it("preserves unread history when shutdown flushes the store", async () => {
    const file = makeTempFile();
    const original = new ListeningHistory(file);
    original.recordStart("uid-1", { id: "a", title: "Artist - Track" });
    original.recordFinish("uid-1", { id: "a", title: "Artist - Track" }, true);
    await original.flush();

    await new ListeningHistory(file).flush();

    const reloaded = new ListeningHistory(file);
    expect(reloaded.userSummary("uid-1")).toMatchObject({
      plays: 1,
      completes: 1,
    });
    expect(reloaded.topTracks(5)).toHaveLength(1);
  });

  it("expires the session boost after inactivity", async () => {
    vi.useFakeTimers();
    const history = new ListeningHistory(makeTempFile());
    try {
      vi.setSystemTime(new Date("2026-01-01T20:00:00Z"));
      history.recordStart("uid-1", { id: "a", title: "Artist - Track" });
      vi.setSystemTime(new Date("2026-01-06T20:00:00Z"));
      expect(
        history.tasteProfile("uid-1").artistScores.get("artist"),
      ).toBeCloseTo(0.5);
    } finally {
      vi.useRealTimers();
      await history.flush();
    }
  });

  it("counts plays, completes and skips per user", () => {
    const history = new ListeningHistory(makeTempFile());
    history.recordStart("uid-1", { id: "a", title: "Duki - Rockstar" });
    history.recordFinish("uid-1", { id: "a", title: "Duki - Rockstar" }, true);
    history.recordStart("uid-1", { id: "b", title: "Beto - Cumbia" });
    history.recordFinish("uid-1", { id: "b", title: "Beto - Cumbia" }, false);

    expect(history.userSummary("uid-1")).toEqual({
      completes: 1,
      plays: 2,
      skips: 1,
      topArtist: "Duki",
    });
    expect(history.userSummary("unknown")).toEqual({
      completes: 0,
      plays: 0,
      skips: 0,
    });
  });

  it("ranks global tops by plays with completes as tiebreak", () => {
    const history = new ListeningHistory(makeTempFile());
    history.recordStart("uid-1", { id: "a", title: "A" });
    history.recordFinish("uid-1", { id: "a", title: "A" }, false);
    history.recordStart("uid-2", { id: "a", title: "A" });
    history.recordFinish("uid-2", { id: "a", title: "A" }, true);
    history.recordStart("uid-1", { id: "b", title: "B" });
    history.recordFinish("uid-1", { id: "b", title: "B" }, true);
    history.recordStart("uid-1", { id: "b", title: "B" });
    history.recordFinish("uid-1", { id: "b", title: "B" }, true);

    expect(history.topTracks(5).map((track) => track.title)).toEqual([
      "B",
      "A",
    ]);
    expect(history.topTracks(1)).toHaveLength(1);
  });

  it("aggregates top artists across users", () => {
    const history = new ListeningHistory(makeTempFile());
    history.recordStart("uid-1", { id: "a", title: "Duki - Uno" });
    history.recordStart("uid-2", { id: "b", title: "Duki - Dos" });
    history.recordStart("uid-1", { id: "c", title: "Beto - Tres" });

    expect(history.topArtists(5)).toEqual([
      { artist: "Duki", plays: 2 },
      { artist: "Beto", plays: 1 },
    ]);
  });

  it("exposes normalized artist scores and recent artists", () => {
    const history = new ListeningHistory(makeTempFile());
    history.recordStart("uid-1", { id: "a", title: "Duki - Uno" });
    history.recordFinish("uid-1", { id: "a", title: "Duki - Uno" }, true);
    history.recordStart("uid-2", { id: "b", title: "DUKI - Dos" });

    expect(history.artistScores()).toEqual(new Map([["duki", 3]]));
    expect([...history.recentArtists(2)].sort()).toEqual(["DUKI", "Duki"]);
    expect(history.recentArtists(1)).toHaveLength(1);
  });

  it("exposes persisted autoplay seeds and the last requester", () => {
    vi.useFakeTimers();
    try {
      const history = new ListeningHistory(makeTempFile());
      vi.setSystemTime(new Date("2026-01-01T10:00:00Z"));
      history.recordStart("uid-1", { id: "aaaaaaaaaaA", title: "Duki - Uno" });
      history.recordStart("uid-1", {
        id: "deadbeef1234",
        title: "Radio Stream",
      });
      vi.setSystemTime(new Date("2026-01-01T10:05:00Z"));
      history.recordStart("autoplay", { id: "bbbbbbbbbbB", title: "Mix Pick" });
      vi.setSystemTime(new Date("2026-01-01T10:10:00Z"));
      history.recordStart("uid-2", { id: "ccccccccccC", title: "Beto - Dos" });

      // YouTube-shaped ids only, most recent first; the 12-hex direct-URL id
      // is not a mix-expansion seed, and autoplay's own pick is not a seed
      // either (it would make autoplay follow itself after a restart).
      expect(history.recentSeeds(3).map((seed) => seed.id)).toEqual([
        "ccccccccccC",
        "aaaaaaaaaaA",
      ]);
      expect(history.recentSeeds(1).map((seed) => seed.id)).toEqual([
        "ccccccccccC",
      ]);
      // Autoplay's own plays never count as the requester.
      expect(history.lastRequesterUid()).toBe("uid-2");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports no requester when only autoplay has played", () => {
    const history = new ListeningHistory(makeTempFile());
    history.recordStart("autoplay", { id: "aaaaaaaaaaA", title: "Mix Pick" });
    expect(history.lastRequesterUid()).toBeUndefined();
  });

  it("weights the current session over older taste", () => {
    vi.useFakeTimers();
    try {
      const history = new ListeningHistory(makeTempFile());
      vi.setSystemTime(new Date("2026-01-01T20:00:00Z"));
      history.recordStart("uid-1", { id: "e1", title: "Daft Punk - Around" });
      history.recordFinish(
        "uid-1",
        { id: "e1", title: "Daft Punk - Around" },
        true,
      );
      vi.setSystemTime(new Date("2026-01-02T20:00:00Z"));
      history.recordStart("uid-1", { id: "r1", title: "Metallica - One" });

      const profile = history.tasteProfile("uid-1");
      expect(profile.artistScores.get("metallica")).toBeGreaterThan(
        profile.artistScores.get("daft punk") ?? 0,
      );
      expect(profile.tokenScores.get("one")).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns an empty profile without data", () => {
    const history = new ListeningHistory(makeTempFile());
    const profile = history.tasteProfile("nobody");

    expect(profile.artistScores.size).toBe(0);
    expect(profile.tokenScores.size).toBe(0);
  });

  it("persists across instances", async () => {
    const file = makeTempFile();
    const history = new ListeningHistory(file);
    history.recordStart("uid-1", { id: "a", title: "Duki - Rockstar" });
    history.recordFinish("uid-1", { id: "a", title: "Duki - Rockstar" }, true);
    await history.flush();

    const reloaded = new ListeningHistory(file);
    expect(reloaded.userSummary("uid-1")).toEqual({
      completes: 1,
      plays: 1,
      skips: 0,
      topArtist: "Duki",
    });
    expect(reloaded.topTracks(5).map((track) => track.title)).toEqual([
      "Duki - Rockstar",
    ]);
  });

  it("starts fresh on corrupt files", () => {
    const badFile = makeTempFile();
    writeFileSync(badFile, "{not json", "utf8");

    const history = new ListeningHistory(badFile);
    expect(history.topTracks(5)).toEqual([]);
    expect(history.userSummary("uid-1").plays).toBe(0);
  });

  it("prunes old entries past the caps", async () => {
    const file = makeTempFile();
    const history = new ListeningHistory(file, undefined, {
      maxGlobalTracks: 3,
      maxTracksPerUser: 2,
    });
    for (const id of ["a", "b", "c", "d"]) {
      history.recordStart("uid-1", { id, title: `Track ${id}` });
    }
    await history.flush();

    const reloaded = new ListeningHistory(file);
    expect(reloaded.topTracks(10)).toHaveLength(3);
    expect(reloaded.userSummary("uid-1").plays).toBe(2);
    expect(history.topTracks(10)).toHaveLength(3);
    expect(history.userSummary("uid-1").plays).toBe(2);
  });

  // Seeded files instead of thousands of record calls: one atomic write
  // each, and every count still exceeds the matching previous cap
  // (2000/10000/500) so each test fails against the old code.
  function seedHistoryFile(
    file: string,
    trackCount: number,
    uid = "uid-1",
  ): void {
    const base = Date.now();
    const tracks: Record<string, unknown> = {};
    for (let index = 0; index < trackCount; index++) {
      tracks[`t${index}`] = {
        completes: 0,
        lastPlayedAt: base + index,
        plays: 1,
        skips: 0,
        title: `Artist - Track ${index}`,
      };
    }
    writeFileSync(
      file,
      JSON.stringify({
        global: tracks,
        users: { [uid]: { plays: [], tracks } },
        version: 1,
      }),
      "utf8",
    );
  }

  it("keeps fifty thousand tracks per user by default", async () => {
    const file = makeTempFile();
    seedHistoryFile(file, 49999);
    const history = new ListeningHistory(file);

    history.recordStart("uid-1", { id: "new", title: "Artist - New" });
    await history.flush();

    expect(history.userSummary("uid-1").plays).toBe(50000);
  });

  it("keeps fifty thousand global tracks by default", async () => {
    const file = makeTempFile();
    seedHistoryFile(file, 49999);
    const history = new ListeningHistory(file);

    history.recordStart("uid-1", { id: "new", title: "Artist - New" });
    await history.flush();

    expect(history.topTracks(60000)).toHaveLength(50000);
  });

  it("keeps fifty thousand recent plays by default", async () => {
    const file = makeTempFile();
    seedHistoryFile(file, 1);
    const raw = JSON.parse(readFileSync(file, "utf8")) as {
      users: Record<
        string,
        { plays: { at: number; completed: boolean; id: string }[] }
      >;
    };
    const base = Date.now();
    raw.users["uid-1"]!.plays = Array.from({ length: 49999 }, (_, index) => ({
      at: base + index,
      completed: true,
      id: "t0",
    }));
    writeFileSync(file, JSON.stringify(raw), "utf8");
    const history = new ListeningHistory(file);

    history.recordStart("uid-1", { id: "t0", title: "Artist - Track 0" });
    await history.flush();

    const reloaded = JSON.parse(readFileSync(file, "utf8")) as {
      users: Record<string, { plays: unknown[] }>;
    };
    expect(reloaded.users["uid-1"]?.plays).toHaveLength(50000);
  });

  it("coalesces the writes of a burst of plays into one", async () => {
    // Regression: every recordStart and recordFinish serialized and wrote
    // the whole history file at once.
    const file = makeTempFile();
    const history = new ListeningHistory(file);
    history.load();
    for (let index = 0; index < 10; index++) {
      history.recordStart("uid-1", { id: `id-${index}`, title: `T ${index}` });
      history.recordFinish(
        "uid-1",
        { id: `id-${index}`, title: `T ${index}` },
        true,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(existsSync(file)).toBe(false);
    await history.flush();
    const saved = JSON.parse(readFileSync(file, "utf8")) as {
      global: Record<string, unknown>;
    };
    expect(Object.keys(saved.global)).toHaveLength(10);
  });
});
