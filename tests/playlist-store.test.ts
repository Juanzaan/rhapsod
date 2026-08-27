import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  MAX_PLAYLISTS_PER_USER,
  MAX_TRACKS_PER_PLAYLIST,
  normalizePlaylistName,
  PlaylistStore,
} from "../src/application/playlist-store.js";

const directory = mkdtempSync(join(tmpdir(), "rhapsod-playlists-"));

afterAll(() => {
  rmSync(directory, { force: true, recursive: true });
});

let storeCounter = 0;
function makeStore(): PlaylistStore {
  const name = `store-${storeCounter++}.json`;
  return new PlaylistStore(join(directory, name));
}

describe("normalizePlaylistName", () => {
  it("lowercases and trims valid names", () => {
    expect(normalizePlaylistName("  Fiesta  ")).toBe("fiesta");
    expect(normalizePlaylistName("My_Playlist-1")).toBe("my_playlist-1");
  });

  it("rejects invalid names", () => {
    expect(() => normalizePlaylistName("")).toThrow(/1 a 32 caracteres/);
    expect(() => normalizePlaylistName("a b")).toThrow(/1 a 32 caracteres/);
    expect(() => normalizePlaylistName("a".repeat(33))).toThrow(
      /1 a 32 caracteres/,
    );
    expect(() => normalizePlaylistName("Café!")).toThrow(/1 a 32 caracteres/);
  });
});

describe("PlaylistStore", () => {
  const track = (id: string) => ({
    id,
    source: `https://www.youtube.com/watch?v=${id}`,
    title: `Track ${id}`,
  });

  it("round-trips a saved playlist", async () => {
    const store = makeStore();
    store.save("uid-1", "Fiesta", [track("a"), track("b")]);
    await store.flush();
    const loaded = store.load("uid-1", "fiesta");
    expect(loaded?.name).toBe("fiesta");
    expect(loaded?.tracks).toHaveLength(2);
    expect(loaded?.tracks[0]?.title).toBe("Track a");
  });

  it("replaces an existing playlist of the same name", async () => {
    const store = makeStore();
    store.save("uid-1", "fiesta", [track("a")]);
    store.save("uid-1", "fiesta", [track("b"), track("c")]);
    await store.flush();
    expect(store.load("uid-1", "fiesta")?.tracks).toHaveLength(2);
    expect(store.list("uid-1")).toHaveLength(1);
  });

  it("keeps track duration and drops invalid tracks", async () => {
    const store = makeStore();
    store.save("uid-1", "fiesta", [
      { ...track("a"), durationSeconds: 210 },
      { id: "", source: "x", title: "bad" },
    ]);
    await store.flush();
    expect(store.load("uid-1", "fiesta")?.tracks).toHaveLength(1);
    expect(store.load("uid-1", "fiesta")?.tracks[0]?.durationSeconds).toBe(210);
  });

  it("enforces the per-user playlist limit", () => {
    const store = makeStore();
    for (let i = 0; i < MAX_PLAYLISTS_PER_USER; i++) {
      store.save("uid-1", `pl${i}`, [track("a")]);
    }
    expect(() => store.save("uid-1", "overflow", [track("a")])).toThrow(
      /Límite de 20 playlists/,
    );
  });

  it("enforces the per-playlist track limit", () => {
    const store = makeStore();
    const many = Array.from({ length: MAX_TRACKS_PER_PLAYLIST + 1 }, (_, i) =>
      track(`t${i}`),
    );
    expect(() => store.save("uid-1", "fiesta", many)).toThrow(/200 pistas/);
  });

  it("lists playlists sorted by name", () => {
    const store = makeStore();
    store.save("uid-1", "zeta", [track("a")]);
    store.save("uid-1", "alfa", [track("b")]);
    expect(store.list("uid-1").map((p) => p.name)).toEqual(["alfa", "zeta"]);
    expect(store.list("other").length).toBe(0);
  });

  it("deletes a playlist owned by the caller", async () => {
    const store = makeStore();
    store.save("uid-1", "fiesta", [track("a")]);
    expect(store.delete("uid-1", "fiesta", false)).toBe(true);
    expect(store.load("uid-1", "fiesta")).toBeUndefined();
    await store.flush();
    expect(store.load("uid-1", "fiesta")).toBeUndefined();
  });

  it("does not delete another user's playlist without allowAnyUser", () => {
    const store = makeStore();
    store.save("uid-2", "fiesta", [track("a")]);
    expect(store.delete("uid-1", "fiesta", false)).toBe(false);
    expect(store.load("uid-2", "fiesta")).toBeDefined();
  });

  it("deletes any user's playlist with allowAnyUser", () => {
    const store = makeStore();
    store.save("uid-2", "fiesta", [track("a")]);
    expect(store.delete("uid-1", "fiesta", true)).toBe(true);
    expect(store.load("uid-2", "fiesta")).toBeUndefined();
  });

  it("recovers from a corrupt store file", async () => {
    const filePath = join(directory, "corrupt.json");
    writeFileSync(filePath, "{ not json");
    const store = new PlaylistStore(filePath);
    store.save("uid-1", "fiesta", [track("a")]);
    await store.flush();
    expect(store.load("uid-1", "fiesta")?.tracks).toHaveLength(1);
  });

  it("recovers from an unsupported version", async () => {
    const filePath = join(directory, "version.json");
    writeFileSync(filePath, JSON.stringify({ version: 99, playlists: {} }));
    const store = new PlaylistStore(filePath);
    store.save("uid-1", "fiesta", [track("a")]);
    await store.flush();
    expect(store.load("uid-1", "fiesta")).toBeDefined();
  });

  it("ignores invalid entries when loading an existing file", () => {
    const filePath = join(directory, "mixed.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        playlists: {
          "uid-1": [
            { name: "ok", createdAt: 1, tracks: [track("a")] },
            { name: "BAD NAME", createdAt: 2, tracks: [] },
            { name: "empty", createdAt: 3, tracks: [] },
          ],
        },
      }),
    );
    const store = new PlaylistStore(filePath);
    expect(store.list("uid-1").map((p) => p.name)).toEqual(["ok"]);
  });
});

describe("PlaylistStore addTracksToPlaylist", () => {
  const track = (id: string) => ({
    id,
    source: `https://www.youtube.com/watch?v=${id}`,
    title: `Track ${id}`,
  });

  it("creates a playlist when it does not exist", () => {
    const store = new PlaylistStore(join(directory, "add-create.json"));
    const result = store.addTracksToPlaylist("uid-1", "fiesta", [
      track("a"),
      track("b"),
    ]);
    expect(result).toEqual({
      added: 2,
      created: true,
      skipped: 0,
      total: 2,
      truncated: false,
    });
    expect(store.load("uid-1", "fiesta")?.tracks).toHaveLength(2);
  });

  it("appends to an existing playlist and skips duplicates", () => {
    const store = new PlaylistStore(join(directory, "add-append.json"));
    store.save("uid-1", "fiesta", [track("a"), track("b")]);
    const result = store.addTracksToPlaylist("uid-1", "fiesta", [
      track("b"),
      track("c"),
      track("b"),
    ]);
    expect(result).toEqual({
      added: 1,
      created: false,
      skipped: 2,
      total: 3,
      truncated: false,
    });
    expect(store.load("uid-1", "fiesta")?.tracks.map((t) => t.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("respects the 200-track limit and reports truncation", () => {
    const store = new PlaylistStore(join(directory, "add-truncate.json"));
    store.save(
      "uid-1",
      "fiesta",
      Array.from({ length: 199 }, (_, i) => track(`t${i}`)),
    );
    const result = store.addTracksToPlaylist("uid-1", "fiesta", [
      track("x1"),
      track("x2"),
      track("x3"),
    ]);
    expect(result.added).toBe(1);
    expect(result.truncated).toBe(true);
    expect(result.total).toBe(200);
  });

  it("reports only duplicates when the playlist is full", () => {
    const store = new PlaylistStore(join(directory, "add-full.json"));
    store.save(
      "uid-1",
      "fiesta",
      Array.from({ length: 200 }, (_, i) => track(`t${i}`)),
    );
    const result = store.addTracksToPlaylist("uid-1", "fiesta", [track("t0")]);
    expect(result).toEqual({
      added: 0,
      created: false,
      skipped: 1,
      total: 200,
      truncated: false,
    });
  });

  it("enforces the per-user playlist limit on creation", () => {
    const store = new PlaylistStore(join(directory, "add-limit.json"));
    for (let i = 0; i < MAX_PLAYLISTS_PER_USER; i++) {
      store.save("uid-1", `pl${i}`, [track("a")]);
    }
    expect(() =>
      store.addTracksToPlaylist("uid-1", "overflow", [track("b")]),
    ).toThrow(/Límite de 20 playlists/);
  });
});

describe("PlaylistStore removeTrackFromPlaylist", () => {
  const track = (id: string) => ({
    id,
    source: `https://www.youtube.com/watch?v=${id}`,
    title: `Track ${id}`,
  });

  it("removes a track by 1-based index", () => {
    const store = new PlaylistStore(join(directory, "remove-ok.json"));
    store.save("uid-1", "fiesta", [track("a"), track("b"), track("c")]);
    const result = store.removeTrackFromPlaylist("uid-1", "fiesta", 2, false);
    expect(result).toEqual({ status: "removed", total: 2 });
    expect(store.load("uid-1", "fiesta")?.tracks.map((t) => t.id)).toEqual([
      "a",
      "c",
    ]);
  });

  it("removing the last track deletes the playlist", () => {
    const store = new PlaylistStore(join(directory, "remove-last.json"));
    store.save("uid-1", "fiesta", [track("a")]);
    const result = store.removeTrackFromPlaylist("uid-1", "fiesta", 1, false);
    expect(result).toEqual({ status: "removed", total: 0 });
    expect(store.load("uid-1", "fiesta")).toBeUndefined();
  });

  it("reports an invalid index", () => {
    const store = new PlaylistStore(join(directory, "remove-bad.json"));
    store.save("uid-1", "fiesta", [track("a")]);
    expect(store.removeTrackFromPlaylist("uid-1", "fiesta", 5, false)).toEqual({
      status: "invalid-index",
      total: 1,
    });
    expect(store.removeTrackFromPlaylist("uid-1", "fiesta", 0, false)).toEqual({
      status: "invalid-index",
      total: 1,
    });
  });

  it("reports a missing playlist", () => {
    const store = new PlaylistStore(join(directory, "remove-missing.json"));
    expect(store.removeTrackFromPlaylist("uid-1", "nada", 1, false)).toEqual({
      status: "not-found",
    });
  });

  it("lets an admin remove from another user's playlist", () => {
    const store = new PlaylistStore(join(directory, "remove-admin.json"));
    store.save("uid-2", "fiesta", [track("a"), track("b")]);
    expect(store.removeTrackFromPlaylist("uid-1", "fiesta", 1, true)).toEqual({
      status: "removed",
      total: 1,
    });
    expect(store.removeTrackFromPlaylist("uid-1", "fiesta", 1, false)).toEqual({
      status: "not-found",
    });
  });
});

describe("PlaylistStore renamePlaylist", () => {
  const track = (id: string) => ({
    id,
    source: `https://www.youtube.com/watch?v=${id}`,
    title: `Track ${id}`,
  });

  it("renames an existing playlist", () => {
    const store = new PlaylistStore(join(directory, "rename-ok.json"));
    store.save("uid-1", "fiesta", [track("a")]);
    expect(store.renamePlaylist("uid-1", "fiesta", "partido", false)).toEqual({
      status: "renamed",
    });
    expect(store.load("uid-1", "fiesta")).toBeUndefined();
    expect(store.load("uid-1", "partido")).toBeDefined();
  });

  it("rejects a rename to an existing name", () => {
    const store = new PlaylistStore(join(directory, "rename-exists.json"));
    store.save("uid-1", "fiesta", [track("a")]);
    store.save("uid-1", "partido", [track("b")]);
    expect(store.renamePlaylist("uid-1", "fiesta", "partido", false)).toEqual({
      status: "name-exists",
      name: "partido",
    });
  });

  it("reports a missing playlist", () => {
    const store = new PlaylistStore(join(directory, "rename-missing.json"));
    expect(store.renamePlaylist("uid-1", "nada", "algo", false)).toEqual({
      status: "not-found",
    });
  });

  it("lets an admin rename another user's playlist", () => {
    const store = new PlaylistStore(join(directory, "rename-admin.json"));
    store.save("uid-2", "fiesta", [track("a")]);
    expect(store.renamePlaylist("uid-1", "fiesta", "partido", true)).toEqual({
      status: "renamed",
    });
    expect(store.renamePlaylist("uid-1", "fiesta", "partido", false)).toEqual({
      status: "not-found",
    });
  });

  it("rejects an invalid new name", () => {
    const store = new PlaylistStore(join(directory, "rename-invalid.json"));
    store.save("uid-1", "fiesta", [track("a")]);
    expect(() =>
      store.renamePlaylist("uid-1", "fiesta", "NO VALIDO!", false),
    ).toThrow(/1 a 32 caracteres/);
  });
});

describe("PlaylistStore getPlaylistInfo", () => {
  const track = (id: string, durationSeconds?: number) => ({
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
    id,
    source: `https://www.youtube.com/watch?v=${id}`,
    title: `Track ${id}`,
  });

  it("sums durations and counts tracks", () => {
    const store = new PlaylistStore(join(directory, "info-ok.json"));
    store.save("uid-1", "fiesta", [
      track("a", 210),
      track("b"),
      track("c", 5400),
    ]);
    const info = store.getPlaylistInfo("uid-1", "fiesta");
    expect(info?.trackCount).toBe(3);
    expect(info?.totalDurationSeconds).toBe(5610);
    expect(typeof info?.createdAt).toBe("number");
  });

  it("returns undefined for a missing playlist", () => {
    const store = new PlaylistStore(join(directory, "info-missing.json"));
    expect(store.getPlaylistInfo("uid-1", "nada")).toBeUndefined();
  });
});
