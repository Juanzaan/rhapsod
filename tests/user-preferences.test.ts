import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { UserError } from "../src/lib/user-error.js";
import {
  MAX_FAVORITES_PER_USER,
  UserPreferences,
} from "../src/application/user-preferences.js";

const tempDirs: string[] = [];

function makeTempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "rhapsod-prefs-"));
  tempDirs.push(dir);
  return join(dir, "user-preferences.json");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0))
    rmSync(dir, { force: true, recursive: true });
});

function makeTrack(
  id: string,
  title = `Track ${id}`,
): {
  readonly id: string;
  readonly source: string;
  readonly title: string;
} {
  return { id, source: `https://example.com/${id}`, title };
}

describe("UserPreferences", () => {
  it("adds and lists favorites per user", () => {
    const prefs = new UserPreferences(makeTempFile());
    prefs.addFavorite("uid-1", makeTrack("a"));
    prefs.addFavorite("uid-1", makeTrack("b"));
    prefs.addFavorite("uid-2", makeTrack("c"));

    expect(prefs.listFavorites("uid-1").map((track) => track.id)).toEqual([
      "a",
      "b",
    ]);
    expect(prefs.listFavorites("uid-2").map((track) => track.id)).toEqual([
      "c",
    ]);
    expect(prefs.listFavorites("unknown")).toEqual([]);
  });

  it("rejects duplicate favorites", () => {
    const prefs = new UserPreferences(makeTempFile());
    prefs.addFavorite("uid-1", makeTrack("a"));

    expect(() => prefs.addFavorite("uid-1", makeTrack("a"))).toThrowError(
      UserError,
    );
    expect(prefs.listFavorites("uid-1")).toHaveLength(1);
  });

  it("caps favorites per user", () => {
    const prefs = new UserPreferences(makeTempFile());
    for (let i = 0; i < MAX_FAVORITES_PER_USER; i++) {
      prefs.addFavorite("uid-1", makeTrack(`track-${i}`));
    }

    expect(() =>
      prefs.addFavorite("uid-1", makeTrack("overflow")),
    ).toThrowError(UserError);
    expect(prefs.listFavorites("uid-1")).toHaveLength(MAX_FAVORITES_PER_USER);
  });

  it("removes favorites by 1-based position", () => {
    const prefs = new UserPreferences(makeTempFile());
    prefs.addFavorite("uid-1", makeTrack("a"));
    prefs.addFavorite("uid-1", makeTrack("b"));

    expect(prefs.removeFavorite("uid-1", 1)?.id).toBe("a");
    expect(prefs.listFavorites("uid-1").map((track) => track.id)).toEqual([
      "b",
    ]);
    expect(prefs.removeFavorite("uid-1", 5)).toBeUndefined();
    expect(prefs.removeFavorite("unknown", 1)).toBeUndefined();
  });

  it("persists across instances", async () => {
    const file = makeTempFile();
    const prefs = new UserPreferences(file);
    prefs.addFavorite("uid-1", makeTrack("a", "Persisted"));
    await prefs.flush();

    const reloaded = new UserPreferences(file);
    expect(reloaded.listFavorites("uid-1").map((track) => track.title)).toEqual(
      ["Persisted"],
    );
  });

  it("starts fresh on corrupt or foreign files", () => {
    const badFile = makeTempFile();
    writeFileSync(badFile, "{not json", "utf8");
    expect(new UserPreferences(badFile).listFavorites("uid-1")).toEqual([]);

    const foreignFile = makeTempFile();
    writeFileSync(
      foreignFile,
      JSON.stringify({ version: 999, users: {} }),
      "utf8",
    );
    expect(new UserPreferences(foreignFile).listFavorites("uid-1")).toEqual([]);

    const dirtyFile = makeTempFile();
    writeFileSync(
      dirtyFile,
      JSON.stringify({
        users: {
          "uid-1": [
            { id: "a", source: "https://example.com/a", title: "Kept" },
            { id: "", source: "", title: "" },
            "garbage",
            null,
          ],
        },
        version: 1,
      }),
      "utf8",
    );
    expect(
      new UserPreferences(dirtyFile).listFavorites("uid-1").map((t) => t.id),
    ).toEqual(["a"]);
  });

  it("defaults the preferred source to auto", () => {
    const prefs = new UserPreferences(makeTempFile());

    expect(prefs.getPreferredSource("uid-1")).toBe("auto");
  });

  it("stores and restores the preferred source", async () => {
    const file = makeTempFile();
    const prefs = new UserPreferences(file);

    expect(prefs.setPreferredSource("uid-1", "soundcloud")).toBe("soundcloud");
    expect(prefs.getPreferredSource("uid-1")).toBe("soundcloud");
    await prefs.flush();

    const reloaded = new UserPreferences(file);
    expect(reloaded.getPreferredSource("uid-1")).toBe("soundcloud");
    expect(reloaded.getPreferredSource("uid-2")).toBe("auto");
  });

  it("rejects unknown sources", () => {
    const prefs = new UserPreferences(makeTempFile());

    expect(() => prefs.setPreferredSource("uid-1", "spotify")).toThrowError(
      UserError,
    );
    expect(prefs.getPreferredSource("uid-1")).toBe("auto");
  });

  it("migrates the legacy favorites-array format", () => {
    const legacyFile = makeTempFile();
    writeFileSync(
      legacyFile,
      JSON.stringify({
        users: { "uid-1": [{ id: "a", source: "s", title: "Kept" }] },
        version: 1,
      }),
      "utf8",
    );

    const prefs = new UserPreferences(legacyFile);
    expect(prefs.listFavorites("uid-1").map((t) => t.id)).toEqual(["a"]);
    expect(prefs.getPreferredSource("uid-1")).toBe("auto");
  });

  it("keeps source-only entries without favorites", async () => {
    const file = makeTempFile();
    const prefs = new UserPreferences(file);
    prefs.setPreferredSource("uid-1", "youtube");
    await prefs.flush();

    const reloaded = new UserPreferences(file);
    expect(reloaded.getPreferredSource("uid-1")).toBe("youtube");
    expect(reloaded.listFavorites("uid-1")).toEqual([]);
  });
});
