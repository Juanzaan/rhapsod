import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { MinimalLogger } from "../observability/logger.js";
import { noopLogger } from "../observability/logger.js";

export interface StoredPlaylistTrack {
  readonly durationSeconds?: number;
  readonly id: string;
  readonly source: string;
  readonly title: string;
}

export interface SavedPlaylist {
  readonly name: string;
  readonly createdAt: number;
  readonly tracks: readonly StoredPlaylistTrack[];
}

export interface PlaylistSummary {
  readonly createdAt: number;
  readonly name: string;
  readonly trackCount: number;
}

export const MAX_PLAYLISTS_PER_USER = 20;
export const MAX_TRACKS_PER_PLAYLIST = 200;
export const PLAYLIST_NAME_MAX_LENGTH = 32;

const PLAYLIST_NAME_RE = /^[a-z0-9-_]{1,32}$/;

interface SerializedPlaylist {
  readonly name: string;
  readonly createdAt: number;
  readonly tracks: readonly StoredPlaylistTrack[];
}

interface PlaylistStoreFile {
  readonly version: 1;
  readonly playlists: Record<string, readonly SerializedPlaylist[]>;
}

export function normalizePlaylistName(raw: string): string {
  const name = raw.trim().toLowerCase();
  if (!PLAYLIST_NAME_RE.test(name)) {
    throw new Error(
      "Usá: nombre de playlist de 1 a 32 caracteres (a-z, 0-9, - o _).",
    );
  }
  return name;
}

function parseStoredTrack(
  raw: unknown,
): StoredPlaylistTrack | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    record.id.length === 0 ||
    typeof record.title !== "string" ||
    record.title.length === 0 ||
    typeof record.source !== "string" ||
    record.source.length === 0
  ) {
    return undefined;
  }
  const durationSeconds =
    typeof record.durationSeconds === "number" &&
    Number.isFinite(record.durationSeconds) &&
    record.durationSeconds > 0
      ? Math.round(record.durationSeconds)
      : undefined;
  return {
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
    id: record.id,
    source: record.source,
    title: record.title,
  };
}

export class PlaylistStore {
  readonly #filePath: string;
  readonly #logger: MinimalLogger;
  #playlists = new Map<string, SerializedPlaylist[]>();
  #loaded = false;
  #writeChain: Promise<void> = Promise.resolve();

  constructor(filePath: string, logger?: MinimalLogger) {
    this.#filePath = filePath;
    this.#logger = logger ?? noopLogger;
  }

  save(
    ownerUid: string,
    rawName: string,
    tracks: readonly StoredPlaylistTrack[],
  ): number {
    const name = normalizePlaylistName(rawName);
    this.#ensureLoaded();
    const cleanTracks: StoredPlaylistTrack[] = [];
    for (const track of tracks) {
      const parsed = parseStoredTrack(track);
      if (parsed !== undefined) cleanTracks.push(parsed);
    }
    if (cleanTracks.length === 0) {
      throw new Error("No hay pistas válidas para guardar en la playlist.");
    }
    if (cleanTracks.length > MAX_TRACKS_PER_PLAYLIST) {
      throw new Error(
        `Una playlist no puede tener más de ${MAX_TRACKS_PER_PLAYLIST} pistas.`,
      );
    }
    let list = this.#playlists.get(ownerUid);
    if (list === undefined) {
      list = [];
      this.#playlists.set(ownerUid, list);
    }
    const existing = list.find((playlist) => playlist.name === name);
    const entry: SerializedPlaylist = {
      createdAt: existing?.createdAt ?? Date.now(),
      name,
      tracks: cleanTracks,
    };
    if (existing !== undefined) {
      const index = list.indexOf(existing);
      list[index] = entry;
    } else {
      if (list.length >= MAX_PLAYLISTS_PER_USER) {
        throw new Error(
          `Límite de ${MAX_PLAYLISTS_PER_USER} playlists por usuario.`,
        );
      }
      list.push(entry);
    }
    void this.#schedulePersist();
    return entry.tracks.length;
  }

  load(ownerUid: string, rawName: string): SavedPlaylist | undefined {
    const name = normalizePlaylistName(rawName);
    this.#ensureLoaded();
    const playlist = this.#playlists
      .get(ownerUid)
      ?.find((entry) => entry.name === name);
    if (playlist === undefined) return undefined;
    return {
      createdAt: playlist.createdAt,
      name: playlist.name,
      tracks: playlist.tracks,
    };
  }

  list(ownerUid: string): readonly PlaylistSummary[] {
    this.#ensureLoaded();
    return (this.#playlists.get(ownerUid) ?? [])
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => ({
        createdAt: entry.createdAt,
        name: entry.name,
        trackCount: entry.tracks.length,
      }));
  }

  show(ownerUid: string, rawName: string): SavedPlaylist | undefined {
    return this.load(ownerUid, rawName);
  }

  delete(ownerUid: string, rawName: string, allowAnyUser: boolean): boolean {
    const name = normalizePlaylistName(rawName);
    this.#ensureLoaded();
    if (allowAnyUser) {
      for (const [uid, list] of this.#playlists) {
        const index = list.findIndex((entry) => entry.name === name);
        if (index !== -1) {
          list.splice(index, 1);
          if (list.length === 0) this.#playlists.delete(uid);
          void this.#schedulePersist();
          return true;
        }
      }
      return false;
    }
    const list = this.#playlists.get(ownerUid);
    const index = list?.findIndex((entry) => entry.name === name) ?? -1;
    if (list === undefined || index === -1) return false;
    list.splice(index, 1);
    if (list.length === 0) this.#playlists.delete(ownerUid);
    void this.#schedulePersist();
    return true;
  }

  flush(): Promise<void> {
    return this.#writeChain;
  }

  #ensureLoaded(): void {
    if (this.#loaded) return;
    this.#loaded = true;
    if (!existsSync(this.#filePath)) return;
    try {
      const parsed = JSON.parse(
        readFileSync(this.#filePath, "utf8"),
      ) as PlaylistStoreFile;
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        parsed.version !== 1
      ) {
        throw new Error("Unsupported playlist store version");
      }
      const byUser = parsed.playlists;
      if (typeof byUser === "object" && byUser !== null) {
        for (const [uid, rawList] of Object.entries(byUser)) {
          if (!Array.isArray(rawList)) continue;
          const list: SerializedPlaylist[] = [];
          for (const rawEntry of rawList) {
            if (typeof rawEntry !== "object" || rawEntry === null) continue;
            const record = rawEntry as Record<string, unknown>;
            if (
              typeof record.name !== "string" ||
              !PLAYLIST_NAME_RE.test(record.name) ||
              typeof record.createdAt !== "number" ||
              !Array.isArray(record.tracks)
            ) {
              continue;
            }
            const tracks = record.tracks
              .map(parseStoredTrack)
              .filter((track): track is StoredPlaylistTrack => track !== undefined)
              .slice(0, MAX_TRACKS_PER_PLAYLIST);
            if (tracks.length === 0) continue;
            list.push({
              createdAt: record.createdAt,
              name: record.name,
              tracks,
            });
          }
          if (list.length > 0) {
            this.#playlists.set(uid, list.slice(0, MAX_PLAYLISTS_PER_USER));
          }
        }
      }
    } catch (error) {
      this.#logger.warn(
        { err: error, filePath: this.#filePath },
        "PlaylistStore: corrupt store file, starting fresh",
      );
      this.#playlists.clear();
    }
  }

  #schedulePersist(): Promise<void> {
    const write = this.#writeChain.then(() => this.#persistNow());
    this.#writeChain = write.catch(() => undefined);
    return write;
  }

  async #persistNow(): Promise<void> {
    try {
      await mkdir(dirname(this.#filePath), { recursive: true });
      const data: PlaylistStoreFile = {
        version: 1,
        playlists: Object.fromEntries(
          [...this.#playlists.entries()].map(([uid, list]) => [uid, list]),
        ),
      };
      const temporary = `${this.#filePath}.tmp`;
      await writeFile(temporary, JSON.stringify(data), {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temporary, this.#filePath);
    } catch (error) {
      this.#logger.warn(
        { err: error },
        "PlaylistStore: failed to persist playlists",
      );
    }
  }
}