import { dirname } from "node:path";
import { mkdir, rename, writeFile } from "node:fs/promises";

import type { MinimalLogger } from "../observability/logger.js";
import { noopLogger } from "../observability/logger.js";
import { readJsonFile } from "../lib/json-file-store.js";
import { parseArtistTitle } from "../media/lyrics.js";

export interface ListeningTrackInput {
  readonly id: string;
  readonly title: string;
}

export interface ListeningTrackStats {
  readonly artist?: string;
  readonly completes: number;
  readonly lastPlayedAt: number;
  readonly plays: number;
  readonly skips: number;
  readonly title: string;
}

export interface ListeningArtistStats {
  readonly artist: string;
  readonly plays: number;
}

export interface ListeningUserSummary {
  readonly completes: number;
  readonly plays: number;
  readonly skips: number;
  readonly topArtist?: string;
}

interface StoredTrackStats {
  artist?: string;
  completes: number;
  lastPlayedAt: number;
  plays: number;
  skips: number;
  title: string;
}

const MAX_TRACKS_PER_USER = 500;
const MAX_GLOBAL_TRACKS = 2000;

function parseTrackStats(raw: unknown): StoredTrackStats | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  if (typeof record.title !== "string" || record.title.length === 0)
    return undefined;
  const count = (value: unknown): number =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0
      ? value
      : 0;
  return {
    ...(typeof record.artist === "string" && record.artist.length > 0
      ? { artist: record.artist }
      : {}),
    completes: count(record.completes),
    lastPlayedAt:
      typeof record.lastPlayedAt === "number" &&
      Number.isFinite(record.lastPlayedAt)
        ? record.lastPlayedAt
        : Date.now(),
    plays: count(record.plays),
    skips: count(record.skips),
    title: record.title,
  };
}

function parseStatsMap(raw: unknown): Map<string, StoredTrackStats> {
  const stats = new Map<string, StoredTrackStats>();
  if (typeof raw !== "object" || raw === null) return stats;
  for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (id.length === 0) continue;
    const parsed = parseTrackStats(entry);
    if (parsed !== undefined) stats.set(id, parsed);
  }
  return stats;
}

function parseHistoryFile(raw: unknown):
  | {
      global: Map<string, StoredTrackStats>;
      users: Map<string, Map<string, StoredTrackStats>>;
    }
  | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as {
    global?: unknown;
    users?: unknown;
    version?: unknown;
  };
  if (record.version !== 1) return undefined;
  const users = new Map<string, Map<string, StoredTrackStats>>();
  if (typeof record.users === "object" && record.users !== null) {
    for (const [uid, tracks] of Object.entries(
      record.users as Record<string, unknown>,
    )) {
      if (uid.length === 0) continue;
      const parsed = parseStatsMap(tracks);
      if (parsed.size > 0) users.set(uid, parsed);
    }
  }
  return { global: parseStatsMap(record.global), users };
}

function rankTracks(
  stats: Map<string, StoredTrackStats>,
  limit: number,
): ListeningTrackStats[] {
  return [...stats.values()]
    .map((entry) => ({ ...entry }))
    .sort(
      (a, b) =>
        b.plays - a.plays ||
        b.completes - a.completes ||
        b.lastPlayedAt - a.lastPlayedAt,
    )
    .slice(0, limit);
}

// Persistent listening stats: what played, what completed, what got
// skipped, per user and globally. Feeds !tops / !mystats today and the
// adaptive autoplay profile tomorrow (same signals, no second store).
// Technical failures never reach here: callers only report completed
// (played through) and skipped (user moved on).
export class ListeningHistory {
  readonly #filePath: string;
  readonly #logger: MinimalLogger;
  readonly #maxGlobalTracks: number;
  readonly #maxTracksPerUser: number;
  #users = new Map<string, Map<string, StoredTrackStats>>();
  #global = new Map<string, StoredTrackStats>();
  #loaded = false;
  #writeChain: Promise<void> = Promise.resolve();

  constructor(
    filePath: string,
    logger?: MinimalLogger,
    limits: { maxGlobalTracks?: number; maxTracksPerUser?: number } = {},
  ) {
    this.#filePath = filePath;
    this.#logger = logger ?? noopLogger;
    this.#maxGlobalTracks = limits.maxGlobalTracks ?? MAX_GLOBAL_TRACKS;
    this.#maxTracksPerUser = limits.maxTracksPerUser ?? MAX_TRACKS_PER_USER;
  }

  recordStart(uid: string, track: ListeningTrackInput): void {
    this.#ensureLoaded();
    const at = Date.now();
    for (const stats of [this.#userStats(uid), this.#global]) {
      let entry = stats.get(track.id);
      if (entry === undefined) {
        const { artist } = parseArtistTitle(track.title);
        entry = {
          ...(artist === undefined ? {} : { artist }),
          completes: 0,
          lastPlayedAt: at,
          plays: 0,
          skips: 0,
          title: track.title,
        };
        stats.set(track.id, entry);
      }
      entry.plays++;
      entry.lastPlayedAt = at;
    }
    void this.#schedulePersist();
  }

  recordFinish(
    uid: string,
    track: ListeningTrackInput,
    completed: boolean,
  ): void {
    this.#ensureLoaded();
    for (const stats of [this.#userStats(uid), this.#global]) {
      let entry = stats.get(track.id);
      if (entry === undefined) {
        const { artist } = parseArtistTitle(track.title);
        entry = {
          ...(artist === undefined ? {} : { artist }),
          completes: 0,
          lastPlayedAt: Date.now(),
          plays: 0,
          skips: 0,
          title: track.title,
        };
        stats.set(track.id, entry);
      }
      if (completed) entry.completes++;
      else entry.skips++;
    }
    void this.#schedulePersist();
  }

  topTracks(limit: number): readonly ListeningTrackStats[] {
    this.#ensureLoaded();
    return rankTracks(this.#global, Math.max(1, limit));
  }

  topArtists(limit: number): readonly ListeningArtistStats[] {
    this.#ensureLoaded();
    const plays = new Map<string, number>();
    for (const entry of this.#global.values()) {
      if (entry.artist === undefined) continue;
      plays.set(entry.artist, (plays.get(entry.artist) ?? 0) + entry.plays);
    }
    return [...plays.entries()]
      .map(([artist, artistPlays]) => ({ artist, plays: artistPlays }))
      .sort((a, b) => b.plays - a.plays)
      .slice(0, Math.max(1, limit));
  }

  userSummary(uid: string): ListeningUserSummary {
    this.#ensureLoaded();
    const stats = this.#users.get(uid);
    if (stats === undefined) {
      return { completes: 0, plays: 0, skips: 0 };
    }
    let completes = 0;
    let plays = 0;
    let skips = 0;
    const artistPlays = new Map<string, number>();
    for (const entry of stats.values()) {
      completes += entry.completes;
      plays += entry.plays;
      skips += entry.skips;
      if (entry.artist !== undefined) {
        artistPlays.set(
          entry.artist,
          (artistPlays.get(entry.artist) ?? 0) + entry.plays,
        );
      }
    }
    let topArtist: string | undefined;
    let topPlays = 0;
    for (const [artist, artistPlaysCount] of artistPlays) {
      if (artistPlaysCount > topPlays) {
        topPlays = artistPlaysCount;
        topArtist = artist;
      }
    }
    return {
      completes,
      plays,
      skips,
      ...(topArtist === undefined ? {} : { topArtist }),
    };
  }

  async flush(): Promise<void> {
    await this.#schedulePersist();
  }

  #userStats(uid: string): Map<string, StoredTrackStats> {
    let stats = this.#users.get(uid);
    if (stats === undefined) {
      stats = new Map();
      this.#users.set(uid, stats);
    }
    return stats;
  }

  #ensureLoaded(): void {
    if (this.#loaded) return;
    this.#loaded = true;
    const parsed = readJsonFile(this.#filePath, parseHistoryFile);
    if (parsed === undefined) return;
    this.#users = parsed.users;
    this.#global = parsed.global;
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
        global: Object.fromEntries(prune(this.#global, this.#maxGlobalTracks)),
        users: Object.fromEntries(
          [...this.#users.entries()].map(([uid, stats]) => [
            uid,
            Object.fromEntries(prune(stats, this.#maxTracksPerUser)),
          ]),
        ),
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
        "ListeningHistory: failed to persist listening stats",
      );
    }
  }
}

function prune(
  stats: Map<string, StoredTrackStats>,
  cap: number,
): Map<string, StoredTrackStats> {
  if (stats.size <= cap) return stats;
  return new Map(
    [...stats.entries()]
      .sort(([, a], [, b]) => b.lastPlayedAt - a.lastPlayedAt)
      .slice(0, cap),
  );
}
