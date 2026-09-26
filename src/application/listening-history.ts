import type { MinimalLogger } from "../observability/logger.js";
import { noopLogger } from "../observability/logger.js";
import {
  DebouncedWriter,
  readJsonFile,
  writeFileAtomic,
} from "../lib/json-file-store.js";
import { parseArtistTitle } from "../media/lyrics.js";
import {
  tokenizeTitle,
  isYouTubeVideoId,
  AUTOPLAY_UID,
  type AutoplayProfile,
  type AutoplaySeed,
} from "./autoplay-picker.js";

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

export interface ClassicSeed extends AutoplaySeed {
  readonly score: number;
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

// Generous ceilings, not targets: entries run ~200 bytes, so even a full
// store is ~10 MB and real usage (distinct songs actually heard) stays far
// below. History only ever grows by listening, never by provisioning.
const MAX_TRACKS_PER_USER = 50000;
const MAX_GLOBAL_TRACKS = 50000;
const MAX_RECENT_PLAYS = 50000;
const SESSION_GAP_MS = 30 * 60_000;
const SESSION_BOOST = 2;
const DECAY_HALF_LIFE_MS = 5 * 24 * 60 * 60_000;
const HISTORY_VERSION = 2;
// A classic rests this long after it played before autoplay brings it back.
const CLASSIC_REST_MS = 6 * 60 * 60_000;
// Tracks the channel skips this often never come back as classics.
const CLASSIC_MAX_SKIP_RATE = 0.5;

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
  if (record.version !== 1 && record.version !== HISTORY_VERSION) {
    return undefined;
  }
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
  const global = parseStatsMap(record.global);
  if (record.version === 1) removeAutoplayFromGlobal(global, users);
  return { global, users };
}

// Version 1 counted autoplay's own picks as channel plays, so autoplay kept
// reinforcing whatever it had already chosen. The autoplay pseudo-user holds
// exactly those plays; subtracting them once leaves only human requests.
function removeAutoplayFromGlobal(
  global: Map<string, StoredTrackStats>,
  users: ReadonlyMap<string, StoredUserData>,
): void {
  const autoplay = users.get(AUTOPLAY_UID);
  if (autoplay === undefined) return;
  for (const [id, own] of autoplay.tracks) {
    const entry = global.get(id);
    if (entry === undefined) continue;
    entry.plays = Math.max(0, entry.plays - own.plays);
    entry.completes = Math.max(0, entry.completes - own.completes);
  }
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
    .filter((entry) => entry.plays > 0)
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
  readonly #writer = new DebouncedWriter(() => this.#persistNow());

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

  /** Reads the file now instead of on the first recorded play. */
  load(): void {
    this.#ensureLoaded();
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
      // Autoplay's own picks are not channel requests: the global entry
      // only learns they played recently (so classics rest) without
      // gaining plays that would make autoplay reinforce itself.
      if (stats !== this.#global || uid !== AUTOPLAY_UID) entry.plays++;
      entry.lastPlayedAt = at;
    }
    const plays = this.#userData(uid).plays;
    plays.push({ at, completed: false, id: track.id });
    while (plays.length > MAX_RECENT_PLAYS) plays.shift();
    this.#writer.schedule();
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
      // A finished autoplay pick often means nobody was listening; a skip
      // is always someone acting, so only skips reach the channel stats.
      if (completed) {
        if (stats !== this.#global || uid !== AUTOPLAY_UID) entry.completes++;
      } else {
        entry.skips++;
      }
    }
    const plays = this.#userData(uid).plays;
    const open = [...plays].reverse().find((event) => event.id === track.id);
    if (open !== undefined) {
      plays[plays.indexOf(open)] = { ...open, completed };
    } else {
      plays.push({ at: Date.now(), completed, id: track.id });
      while (plays.length > MAX_RECENT_PLAYS) plays.shift();
    }
    this.#writer.schedule();
  }

  topTracks(limit: number): readonly ListeningTrackStats[] {
    this.#ensureLoaded();
    return rankTracks(this.#global, Math.max(1, limit));
  }

  topArtists(limit: number): readonly ListeningArtistStats[] {
    this.#ensureLoaded();
    const plays = new Map<string, number>();
    for (const entry of this.#global.values()) {
      if (entry.artist === undefined || entry.plays === 0) continue;
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

  // Autoplay seeds that survive restarts: the most recently played YouTube
  // tracks from the persisted store, so past user choices keep driving the
  // rotation even when the in-memory session history is empty.
  recentSeeds(limit: number): readonly AutoplaySeed[] {
    this.#ensureLoaded();
    return [...this.#global.entries()]
      .filter(([id, entry]) => isYouTubeVideoId(id) && entry.plays > 0)
      .sort(([, a], [, b]) => b.lastPlayedAt - a.lastPlayedAt)
      .map(([id, entry]) => ({
        ...(entry.artist === undefined ? {} : { artist: entry.artist }),
        id,
        title: entry.title,
      }))
      .slice(0, Math.max(1, limit));
  }

  // The most recent non-autoplay listener, so autoplay follows a real user's
  // taste after a restart instead of falling back to the global profile.
  lastRequesterUid(): string | undefined {
    this.#ensureLoaded();
    let bestUid: string | undefined;
    let bestAt = -1;
    for (const [uid, data] of this.#users) {
      if (uid === AUTOPLAY_UID) continue;
      const last = data.plays.at(-1);
      if (last !== undefined && last.at > bestAt) {
        bestAt = last.at;
        bestUid = uid;
      }
    }
    return bestUid;
  }

  /**
   * The channel's all-time favorites that are due to come back: tracks
   * people asked for and let play, rested for a few hours, rarely skipped.
   * Scored by completions over plays so a song everyone sits through ranks
   * above one that was merely requested often.
   */
  classicSeeds(limit: number, now = Date.now()): readonly ClassicSeed[] {
    this.#ensureLoaded();
    const seeds: ClassicSeed[] = [];
    for (const [id, entry] of this.#global) {
      if (!isYouTubeVideoId(id) || entry.plays === 0) continue;
      if (now - entry.lastPlayedAt < CLASSIC_REST_MS) continue;
      const heard = entry.completes + entry.skips;
      if (heard > 0 && entry.skips / heard > CLASSIC_MAX_SKIP_RATE) continue;
      seeds.push({
        ...(entry.artist === undefined ? {} : { artist: entry.artist }),
        id,
        score: 2 * entry.completes + entry.plays - 2 * entry.skips,
        title: entry.title,
      });
    }
    return seeds.sort((a, b) => b.score - a.score).slice(0, Math.max(1, limit));
  }

  /**
   * One seed track per artist the channel listens to most, for discovery
   * mixes that stay in the channel's taste. The seed is the artist's most
   * completed YouTube track.
   */
  channelArtistSeeds(limit: number): readonly AutoplaySeed[] {
    this.#ensureLoaded();
    const byArtist = new Map<
      string,
      { plays: number; seed: AutoplaySeed; seedCompletes: number }
    >();
    for (const [id, entry] of this.#global) {
      if (entry.artist === undefined || entry.plays === 0) continue;
      if (!isYouTubeVideoId(id)) continue;
      const key = entry.artist.toLowerCase();
      const current = byArtist.get(key);
      const seed = { artist: entry.artist, id, title: entry.title };
      if (current === undefined) {
        byArtist.set(key, {
          plays: entry.plays,
          seed,
          seedCompletes: entry.completes,
        });
        continue;
      }
      current.plays += entry.plays;
      if (entry.completes > current.seedCompletes) {
        current.seed = seed;
        current.seedCompletes = entry.completes;
      }
    }
    return [...byArtist.values()]
      .sort((a, b) => b.plays - a.plays)
      .slice(0, Math.max(1, limit))
      .map((artist) => artist.seed);
  }

  /** Whether this track ever played on the channel, requested or not. */
  hasHeard(id: string): boolean {
    this.#ensureLoaded();
    return this.#global.has(id);
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
    const now = Date.now();
    // Current session: chain backwards while gaps stay under 30 minutes.
    // It dominates so today's taste wins over last week's.
    let sessionStart = plays.length;
    for (let i = plays.length - 1; i >= 0; i--) {
      if (now - plays[i]!.at > SESSION_GAP_MS && i === plays.length - 1) break;
      sessionStart = i;
      if (i === 0) break;
      if (plays[i]!.at - plays[i - 1]!.at > SESSION_GAP_MS) break;
    }
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
    await this.#writer.flush();
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
    const parsed = readJsonFile(this.#filePath, parseHistoryFile, this.#logger);
    if (parsed === undefined) return;
    this.#users = parsed.users;
    this.#global = parsed.global;
    this.#prune();
  }

  #prune(): void {
    this.#global = prune(this.#global, this.#maxGlobalTracks);
    for (const data of this.#users.values()) {
      data.tracks = prune(data.tracks, this.#maxTracksPerUser);
    }
  }

  async #persistNow(): Promise<void> {
    this.#prune();
    try {
      const data = {
        global: Object.fromEntries(this.#global),
        users: Object.fromEntries(
          [...this.#users.entries()].map(([uid, data]) => [
            uid,
            {
              plays: data.plays.slice(-MAX_RECENT_PLAYS),
              tracks: Object.fromEntries(data.tracks),
            },
          ]),
        ),
        version: HISTORY_VERSION,
      };
      await writeFileAtomic(this.#filePath, JSON.stringify(data), 0o600);
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
