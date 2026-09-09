import { dirname } from "node:path";
import { mkdir, rename, writeFile } from "node:fs/promises";

import type { MinimalLogger } from "../observability/logger.js";
import { noopLogger } from "../observability/logger.js";
import { UserError } from "../lib/user-error.js";
import { readJsonFile } from "../lib/json-file-store.js";

export interface FavoriteTrack {
  readonly addedAt: number;
  readonly durationSeconds?: number;
  readonly id: string;
  readonly source: string;
  readonly title: string;
}

export interface FavoriteInput {
  readonly durationSeconds?: number;
  readonly id: string;
  readonly source: string;
  readonly title: string;
}

function parsePreferencesFile(
  raw: unknown,
): Map<string, FavoriteTrack[]> | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as { users?: unknown; version?: unknown };
  if (record.version !== 1) return undefined;
  if (typeof record.users !== "object" || record.users === null)
    return undefined;
  const favorites = new Map<string, FavoriteTrack[]>();
  for (const [uid, entries] of Object.entries(
    record.users as Record<string, unknown>,
  )) {
    if (uid.length === 0 || !Array.isArray(entries)) continue;
    const clean: FavoriteTrack[] = [];
    for (const entry of entries) {
      const parsed = parseFavorite(entry);
      if (parsed !== undefined) clean.push(parsed);
    }
    if (clean.length > 0) favorites.set(uid, clean);
  }
  return favorites;
}

export const MAX_FAVORITES_PER_USER = 50;

function parseFavorite(raw: unknown): FavoriteTrack | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  if (typeof record.id !== "string" || record.id.length === 0) return undefined;
  if (typeof record.source !== "string" || record.source.length === 0)
    return undefined;
  if (typeof record.title !== "string" || record.title.length === 0)
    return undefined;
  return {
    addedAt:
      typeof record.addedAt === "number" && Number.isFinite(record.addedAt)
        ? record.addedAt
        : Date.now(),
    ...(typeof record.durationSeconds === "number" &&
    Number.isFinite(record.durationSeconds)
      ? { durationSeconds: record.durationSeconds }
      : {}),
    id: record.id,
    source: record.source,
    title: record.title,
  };
}

// Per-TS3-user preferences persisted to local JSON: favorite tracks for
// !fav / !favplay. Same storage pattern as PlaylistStore (serialized write
// chain, atomic tmp+rename, tolerant load that drops corrupt entries).
export class UserPreferences {
  readonly #filePath: string;
  readonly #logger: MinimalLogger;
  #favorites = new Map<string, FavoriteTrack[]>();
  #loaded = false;
  #writeChain: Promise<void> = Promise.resolve();

  constructor(filePath: string, logger?: MinimalLogger) {
    this.#filePath = filePath;
    this.#logger = logger ?? noopLogger;
  }

  listFavorites(uid: string): readonly FavoriteTrack[] {
    this.#ensureLoaded();
    return [...(this.#favorites.get(uid) ?? [])];
  }

  addFavorite(uid: string, track: FavoriteInput): FavoriteTrack {
    this.#ensureLoaded();
    let list = this.#favorites.get(uid);
    if (list === undefined) {
      list = [];
      this.#favorites.set(uid, list);
    }
    const existing = list.find((favorite) => favorite.id === track.id);
    if (existing !== undefined) {
      throw new UserError("Esa canción ya está en tus favoritos.");
    }
    if (list.length >= MAX_FAVORITES_PER_USER) {
      throw new UserError(
        `Límite de ${MAX_FAVORITES_PER_USER} favoritos por usuario.`,
      );
    }
    const entry: FavoriteTrack = {
      addedAt: Date.now(),
      ...(track.durationSeconds === undefined
        ? {}
        : { durationSeconds: track.durationSeconds }),
      id: track.id,
      source: track.source,
      title: track.title,
    };
    list.push(entry);
    void this.#schedulePersist();
    return entry;
  }

  removeFavorite(uid: string, position: number): FavoriteTrack | undefined {
    this.#ensureLoaded();
    const list = this.#favorites.get(uid);
    if (list === undefined) return undefined;
    const [removed] = list.splice(position - 1, 1);
    if (removed === undefined) return undefined;
    if (list.length === 0) this.#favorites.delete(uid);
    void this.#schedulePersist();
    return removed;
  }

  async flush(): Promise<void> {
    await this.#schedulePersist();
  }

  #ensureLoaded(): void {
    if (this.#loaded) return;
    this.#loaded = true;
    this.#favorites =
      readJsonFile(this.#filePath, parsePreferencesFile) ??
      new Map<string, FavoriteTrack[]>();
  }

  #schedulePersist(): Promise<void> {
    const write = this.#writeChain.then(() => this.#persistNow());
    this.#writeChain = write.catch(() => undefined);
    return write;
  }

  async #persistNow(): Promise<void> {
    try {
      await mkdir(dirname(this.#filePath), { recursive: true });
      const data = {
        users: Object.fromEntries(this.#favorites.entries()),
        version: 1 as const,
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
        "UserPreferences: failed to persist favorites",
      );
    }
  }
}
