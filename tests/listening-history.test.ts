import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
});
