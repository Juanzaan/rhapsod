import { dirname } from "node:path";
import { mkdir, rename, writeFile } from "node:fs/promises";

import type { MinimalLogger } from "../observability/logger.js";
import { noopLogger } from "../observability/logger.js";
import { readJsonFile } from "../lib/json-file-store.js";
import { parseArtistTitle } from "../media/lyrics.js";
import { tokenizeTitle, type AutoplayProfile } from "./autoplay-picker.js";

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
const MAX_RECENT_PLAYS = 100;
const SESSION_GAP_MS = 30 * 60_000;
const SESSION_BOOST = 2;
const DECAY_HALF_LIFE_MS = 5 * 24 * 60 * 60_000;

export interface PlayEvent {
  readonly at: number;
  readonly completed: boolean;
  readonly id: string;
}

function parsePlayEvent(raw: unknown): PlayEvent | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  if (typeof record.id !== "string" || record.id.length === 0) return undefined;
  if (typeof record.at !== "number" || !Number.isFinite(record.at)) {
    return undefined;
  }
  return {
    at: record.at,
    completed: record.completed === true,
    id: record.id,
  };
}

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
      users: Map<string, StoredUserData>;
    }
  | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as {
    global?: unknown;
    users?: unknown;
    version?: unknown;
  };
  if (record.version !== 1) return undefined;
  const users = new Map<string, StoredUserData>();
  if (typeof record.users === "object" && record.users !== null) {
    for (const [uid, data] of Object.entries(
      record.users as Record<string, unknown>,
    )) {
      if (uid.length === 0) continue;
      const parsed = parseUserData(data);
      if (parsed !== undefined) users.set(uid, parsed);
    }
  }
  return { global: parseStatsMap(record.global), users };
}

interface StoredUserData {
  plays: PlayEvent[];
  tracks: Map<string, StoredTrackStats>;
}

function parseUserData(raw: unknown): StoredUserData | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as { plays?: unknown; tracks?: unknown };
  const tracks = parseStatsMap(record.tracks);
  const plays: PlayEvent[] = [];
  if (Array.isArray(record.plays)) {
    for (const item of record.plays) {
      const event = parsePlayEvent(item);
      if (event !== undefined) plays.push(event);
    }
  }
  if (tracks.size === 0 && plays.length === 0) return undefined;
  return { plays: plays.slice(-MAX_RECENT_PLAYS), tracks };
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
  #users = new Map<string, StoredUserData>();
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
    for (const stats of [this.#userData(uid).tracks, this.#global]) {
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
    const plays = this.#userData(uid).plays;
    plays.push({ at, completed: false, id: track.id });
    while (plays.length > MAX_RECENT_PLAYS) plays.shift();
    void this.#schedulePersist();
  }

  recordFinish(
    uid: string,
    track: ListeningTrackInput,
    completed: boolean,
  ): void {
    this.#ensureLoaded();
    for (const stats of [this.#userData(uid).tracks, this.#global]) {
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
    const plays = this.#userData(uid).plays;
    const open = [...plays].reverse().find((event) => event.id === track.id);
    if (open !== undefined) {
      plays[plays.indexOf(open)] = { ...open, completed };
    } else {
      plays.push({ at: Date.now(), completed, id: track.id });
      while (plays.length > MAX_RECENT_PLAYS) plays.shift();
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

  artistScores(): ReadonlyMap<string, number> {
    this.#ensureLoaded();
    const scores = new Map<string, number>();
    for (const entry of this.#global.values()) {
      if (entry.artist === undefined) continue;
      const key = entry.artist.toLowerCase();
      scores.set(key, (scores.get(key) ?? 0) + entry.plays + entry.completes);
    }
    return scores;
  }

  recentArtists(limit: number): readonly string[] {
    this.#ensureLoaded();
    return [...this.#global.values()]
      .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)
      .map((entry) => entry.artist)
      .filter((artist): artist is string => artist !== undefined)
      .slice(0, Math.max(1, limit));
  }

  userSummary(uid: string): ListeningUserSummary {
    this.#ensureLoaded();
    const data = this.#users.get(uid);
    if (data === undefined) {
      return { completes: 0, plays: 0, skips: 0 };
    }
    const stats = data.tracks;
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

  tasteProfile(uid: string): AutoplayProfile {
    this.#ensureLoaded();
    const artistScores = new Map<string, number>();
    const tokenScores = new Map<string, number>();
    const plays = this.#users.get(uid)?.plays ?? [];
    // Current session: chain backwards while gaps stay under 30 minutes.
    // It dominates so today's taste wins over last week's.
    let sessionStart = plays.length;
    for (let i = plays.length - 1; i >= 0; i--) {
      sessionStart = i;
      if (i === 0) break;
      if (plays[i]!.at - plays[i - 1]!.at > SESSION_GAP_MS) break;
    }
    const now = Date.now();
    const add = (trackId: string, weight: number): void => {
      const stats = this.#users.get(uid)?.tracks.get(trackId);
      if (stats?.artist !== undefined) {
        const key = stats.artist.toLowerCase();
        artistScores.set(key, (artistScores.get(key) ?? 0) + weight);
      }
      if (stats?.title !== undefined) {
        for (const token of tokenizeTitle(stats.title)) {
          tokenScores.set(token, (tokenScores.get(token) ?? 0) + weight);
        }
      }
    };
    plays.forEach((event, index) => {
      const decay = Math.pow(
        0.5,
        Math.max(0, now - event.at) / DECAY_HALF_LIFE_MS,
      );
      const weight =
        decay * (1 + (event.completed ? 1 : 0)) +
        (index >= sessionStart ? SESSION_BOOST : 0);
      add(event.id, weight);
    });
    return { artistScores, tokenScores };
  }

  async flush(): Promise<void> {
    await this.#schedulePersist();
  }

  #userData(uid: string): StoredUserData {
    let data = this.#users.get(uid);
    if (data === undefined) {
      data = { plays: [], tracks: new Map() };
      this.#users.set(uid, data);
    }
    return data;
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
          [...this.#users.entries()].map(([uid, data]) => [
            uid,
            {
              plays: data.plays.slice(-MAX_RECENT_PLAYS),
              tracks: Object.fromEntries(
                prune(data.tracks, this.#maxTracksPerUser),
              ),
            },
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
