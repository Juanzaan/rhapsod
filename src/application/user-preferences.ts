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

export type PreferredSource = "auto" | "soundcloud" | "youtube";

const PREFERRED_SOURCES: readonly string[] = ["auto", "soundcloud", "youtube"];

function isPreferredSource(value: unknown): value is PreferredSource {
  return typeof value === "string" && PREFERRED_SOURCES.includes(value);
}

interface StoredUserEntry {
  favorites: FavoriteTrack[];
  preferredSource?: PreferredSource;
}

function parseUserEntry(raw: unknown): StoredUserEntry | undefined {
  let preferredSource: PreferredSource | undefined;
  let items: unknown = raw;
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    const record = raw as { favorites?: unknown; preferredSource?: unknown };
    if (isPreferredSource(record.preferredSource)) {
      preferredSource = record.preferredSource;
    }
    items = record.favorites;
  }
  if (!Array.isArray(items)) {
    return preferredSource === undefined
      ? undefined
      : { favorites: [], preferredSource };
  }
  const favorites: FavoriteTrack[] = [];
  for (const item of items) {
    const parsed = parseFavorite(item);
    if (parsed !== undefined) favorites.push(parsed);
  }
  if (favorites.length === 0 && preferredSource === undefined) return undefined;
  return {
    favorites,
    ...(preferredSource === undefined ? {} : { preferredSource }),
  };
}

function parsePreferencesFile(
  raw: unknown,
): Map<string, StoredUserEntry> | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as { users?: unknown; version?: unknown };
  if (record.version !== 1) return undefined;
  if (typeof record.users !== "object" || record.users === null)
    return undefined;
  const users = new Map<string, StoredUserEntry>();
  for (const [uid, entry] of Object.entries(
    record.users as Record<string, unknown>,
  )) {
    if (uid.length === 0) continue;
    const parsed = parseUserEntry(entry);
    if (parsed !== undefined) users.set(uid, parsed);
  }
  return users;
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
// !fav / !favplay and the preferred search source for !fuente. Same storage
// pattern as PlaylistStore (serialized write chain, atomic tmp+rename,
// tolerant load that drops corrupt entries and migrates the legacy
// favorites-array format).
export class UserPreferences {
  readonly #filePath: string;
  readonly #logger: MinimalLogger;
  #users = new Map<string, StoredUserEntry>();
  #loaded = false;
  #writeChain: Promise<void> = Promise.resolve();

  constructor(filePath: string, logger?: MinimalLogger) {
    this.#filePath = filePath;
    this.#logger = logger ?? noopLogger;
  }

  listFavorites(uid: string): readonly FavoriteTrack[] {
    this.#ensureLoaded();
    return [...(this.#users.get(uid)?.favorites ?? [])];
  }

  getPreferredSource(uid: string): PreferredSource {
    this.#ensureLoaded();
    return this.#users.get(uid)?.preferredSource ?? "auto";
  }

  setPreferredSource(uid: string, source: string): PreferredSource {
    if (!isPreferredSource(source)) {
      throw new UserError("Usá: !fuente [youtube|soundcloud|auto].");
    }
    this.#ensureLoaded();
    let entry = this.#users.get(uid);
    if (entry === undefined) {
      entry = { favorites: [] };
      this.#users.set(uid, entry);
    }
    entry.preferredSource = source;
    void this.#schedulePersist();
    return source;
  }

  addFavorite(uid: string, track: FavoriteInput): FavoriteTrack {
    this.#ensureLoaded();
    let entry = this.#users.get(uid);
    if (entry === undefined) {
      entry = { favorites: [] };
      this.#users.set(uid, entry);
    }
    const list = entry.favorites;
    const existing = list.find((favorite) => favorite.id === track.id);
    if (existing !== undefined) {
      throw new UserError("Esa canción ya está en tus favoritos.");
    }
    if (list.length >= MAX_FAVORITES_PER_USER) {
      throw new UserError(
        `Límite de ${MAX_FAVORITES_PER_USER} favoritos por usuario.`,
      );
    }
    const favorite: FavoriteTrack = {
      addedAt: Date.now(),
      ...(track.durationSeconds === undefined
        ? {}
        : { durationSeconds: track.durationSeconds }),
      id: track.id,
      source: track.source,
      title: track.title,
    };
    list.push(favorite);
    void this.#schedulePersist();
    return favorite;
  }

  removeFavorite(uid: string, position: number): FavoriteTrack | undefined {
    if (!Number.isSafeInteger(position) || position < 1) return undefined;
    this.#ensureLoaded();
    const entry = this.#users.get(uid);
    if (entry === undefined) return undefined;
    const [removed] = entry.favorites.splice(position - 1, 1);
    if (removed === undefined) return undefined;
    if (entry.favorites.length === 0 && entry.preferredSource === undefined) {
      this.#users.delete(uid);
    }
    void this.#schedulePersist();
    return removed;
  }

  async flush(): Promise<void> {
    await this.#writeChain;
  }

  #ensureLoaded(): void {
    if (this.#loaded) return;
    this.#loaded = true;
    this.#users =
      readJsonFile(this.#filePath, parsePreferencesFile) ??
      new Map<string, StoredUserEntry>();
  }

  #schedulePersist(): Promise<void> {
    const write = this.#writeChain.then(() => this.#persistNow());
    this.#writeChain = write.catch(() => undefined);
    return write;
  }

  async #persistNow(): Promise<void> {
    try {
      await mkdir(dirname(this.#filePath), { recursive: true });
      const users: Record<string, unknown> = {};
      for (const [uid, entry] of this.#users.entries()) {
        users[uid] = {
          favorites: entry.favorites,
          ...(entry.preferredSource === undefined ||
          entry.preferredSource === "auto"
            ? {}
            : { preferredSource: entry.preferredSource }),
        };
      }
      const data = { users, version: 1 as const };
      const temporary = `${this.#filePath}.tmp`;
      await writeFile(temporary, JSON.stringify(data), {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temporary, this.#filePath);
    } catch (error) {
      this.#logger.warn(
        { err: error },
        "UserPreferences: failed to persist preferences",
      );
    }
  }
}
