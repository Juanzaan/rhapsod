import { createHash } from "node:crypto";

import type { Track } from "../../domain/track.js";
import type { MinimalLogger } from "../../observability/logger.js";
import { noopLogger } from "../../observability/logger.js";

const SKIP_SEGMENTS_ENDPOINT = "https://sponsor.ajay.app/api/skipSegments/";
const CATEGORY = "music_offtopic";
// The API is queried by the first characters of the video id's SHA-256, so
// the server never learns which video is playing: a 4-character prefix
// matches many unrelated videos and the match is picked locally.
const HASH_PREFIX_LENGTH = 4;
const YOUTUBE_VIDEO_ID_RE =
  /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]{11})/;
// A segment that touches the first or last second is an intro or an outro;
// submissions rarely start at exactly 0.
const EDGE_TOLERANCE_SECONDS = 1;
// The segment was submitted against a different cut of the video when its
// recorded duration disagrees with ours by more than this.
const DURATION_TOLERANCE_SECONDS = 3;
// A trim that would leave less than this, or less than MIN_KEPT_SHARE of the
// track, is more likely a bad submission than a long intro.
const MIN_KEPT_SECONDS = 30;
const MIN_KEPT_SHARE = 0.5;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;

export interface MusicBounds {
  /** Where the music starts; absent when the track has no non-music intro. */
  readonly startSeconds?: number;
  /** Where the music ends; absent when the track has no non-music outro. */
  readonly endSeconds?: number;
}

export interface NonMusicSegmentSource {
  /**
   * Music bounds for a track, or undefined when there is nothing to trim,
   * the track is not a YouTube video, or the lookup did not answer within
   * the wait. Never rejects: playback must not depend on this service.
   */
  boundsFor(track: Track): Promise<MusicBounds | undefined>;
}

interface SkipSegmentsEntry {
  readonly videoID?: unknown;
  readonly segments?: unknown;
}

interface SkipSegment {
  readonly actionType?: unknown;
  readonly category?: unknown;
  readonly segment?: unknown;
  readonly videoDuration?: unknown;
}

interface NonMusicSegmentsOptions {
  readonly fetch?: typeof fetch;
  readonly logger?: MinimalLogger;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly waitMs?: number;
}

export function videoIdHashPrefix(videoId: string): string {
  return createHash("sha256")
    .update(videoId)
    .digest("hex")
    .slice(0, HASH_PREFIX_LENGTH);
}

/**
 * Turns the non-music segments of one video into the part of the track to
 * play. Only an intro and an outro are cut: skipping a segment in the middle
 * would need a seek during playback.
 */
export function musicBoundsFromSegments(
  segments: readonly (readonly [number, number])[],
  durationSeconds: number,
): MusicBounds | undefined {
  let startSeconds: number | undefined;
  let endSeconds: number | undefined;
  for (const [start, end] of segments) {
    if (!(start >= 0) || !(end > start)) continue;
    if (start <= EDGE_TOLERANCE_SECONDS) {
      startSeconds = Math.max(startSeconds ?? 0, end);
    }
    if (end >= durationSeconds - EDGE_TOLERANCE_SECONDS) {
      endSeconds = Math.min(endSeconds ?? durationSeconds, start);
    }
  }
  if (startSeconds === undefined && endSeconds === undefined) {
    return undefined;
  }
  const kept = (endSeconds ?? durationSeconds) - (startSeconds ?? 0);
  if (kept < MIN_KEPT_SECONDS || kept < durationSeconds * MIN_KEPT_SHARE) {
    return undefined;
  }
  return {
    ...(startSeconds === undefined ? {} : { startSeconds }),
    ...(endSeconds === undefined ? {} : { endSeconds }),
  };
}

function segmentsForVideo(
  body: unknown,
  videoId: string,
  durationSeconds: number,
): Array<readonly [number, number]> {
  if (!Array.isArray(body)) return [];
  const entry = (body as SkipSegmentsEntry[]).find(
    (candidate) => candidate.videoID === videoId,
  );
  if (entry === undefined || !Array.isArray(entry.segments)) return [];
  const segments: Array<readonly [number, number]> = [];
  for (const raw of entry.segments as SkipSegment[]) {
    if (raw.category !== CATEGORY || raw.actionType !== "skip") continue;
    if (!Array.isArray(raw.segment) || raw.segment.length !== 2) continue;
    const [start, end] = raw.segment as unknown[];
    if (typeof start !== "number" || typeof end !== "number") continue;
    // videoDuration 0 means the submitter's duration is unknown.
    if (
      typeof raw.videoDuration === "number" &&
      raw.videoDuration > 0 &&
      Math.abs(raw.videoDuration - durationSeconds) > DURATION_TOLERANCE_SECONDS
    ) {
      continue;
    }
    segments.push([start, end]);
  }
  return segments;
}

/**
 * Looks up crowd-sourced non-music segments (SponsorBlock's
 * `music_offtopic` category: spoken intros, scenes, credits) so a music
 * video starts at its music and ends with it.
 */
export class NonMusicSegments implements NonMusicSegmentSource {
  readonly #fetch: typeof fetch;
  readonly #logger: MinimalLogger;
  readonly #now: () => number;
  readonly #timeoutMs: number;
  readonly #waitMs: number;
  readonly #entries = new Map<
    string,
    { expiresAt: number; bounds: Promise<MusicBounds | undefined> }
  >();

  constructor(options: NonMusicSegmentsOptions = {}) {
    this.#fetch = options.fetch ?? fetch;
    this.#logger = options.logger ?? noopLogger;
    this.#now = options.now ?? Date.now;
    this.#timeoutMs = options.timeoutMs ?? 4_000;
    this.#waitMs = options.waitMs ?? 1_500;
  }

  boundsFor(track: Track): Promise<MusicBounds | undefined> {
    const durationSeconds = track.durationSeconds;
    const videoId = YOUTUBE_VIDEO_ID_RE.exec(track.source)?.[1];
    if (
      durationSeconds === undefined ||
      durationSeconds <= 0 ||
      videoId === undefined
    ) {
      return Promise.resolve(undefined);
    }
    const lookup = this.#lookup(videoId, durationSeconds);
    // A slow answer still lands in the cache for the next play or the
    // prewarm; this play starts without it instead of waiting.
    return Promise.race([
      lookup,
      new Promise<undefined>((resolve) => {
        const timer = setTimeout(() => resolve(undefined), this.#waitMs);
        timer.unref();
      }),
    ]);
  }

  #lookup(
    videoId: string,
    durationSeconds: number,
  ): Promise<MusicBounds | undefined> {
    const key = `${videoId}:${Math.round(durationSeconds)}`;
    const now = this.#now();
    const cached = this.#entries.get(key);
    if (cached !== undefined && cached.expiresAt > now) return cached.bounds;
    this.#entries.delete(key);
    while (this.#entries.size >= MAX_ENTRIES) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
    const request = this.#request(videoId, durationSeconds);
    const bounds = request.then((result) => {
      // A failed lookup is asked again on the next play instead of pinning
      // "nothing to trim" for the whole cache lifetime.
      if (!result.answered && this.#entries.get(key)?.bounds === bounds) {
        this.#entries.delete(key);
      }
      return result.bounds;
    });
    this.#entries.set(key, { bounds, expiresAt: now + CACHE_TTL_MS });
    return bounds;
  }

  async #request(
    videoId: string,
    durationSeconds: number,
  ): Promise<{ answered: boolean; bounds?: MusicBounds }> {
    try {
      const endpoint = new URL(
        `${SKIP_SEGMENTS_ENDPOINT}${videoIdHashPrefix(videoId)}`,
      );
      endpoint.searchParams.set("categories", JSON.stringify([CATEGORY]));
      endpoint.searchParams.set("actionTypes", JSON.stringify(["skip"]));
      const response = await this.#fetch(endpoint.toString(), {
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      // 404 is the API's answer for "no segments under this prefix".
      if (response.status === 404) return { answered: true };
      if (!response.ok) {
        this.#logger.debug(
          { status: response.status, videoId },
          "Non-music segments: non-OK response",
        );
        return { answered: false };
      }
      const segments = segmentsForVideo(
        await response.json(),
        videoId,
        durationSeconds,
      );
      const bounds = musicBoundsFromSegments(segments, durationSeconds);
      return bounds === undefined
        ? { answered: true }
        : { answered: true, bounds };
    } catch (error) {
      this.#logger.debug(
        { err: error, videoId },
        "Non-music segments: lookup failed",
      );
      return { answered: false };
    }
  }
}
