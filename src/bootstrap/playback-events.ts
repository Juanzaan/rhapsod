import type { AudioPlayerMetrics } from "../audio/audio-player.js";
import { AUTOPLAY_UID } from "../application/autoplay-picker.js";
import type { ListeningHistory } from "../application/listening-history.js";
import type {
  PlaybackEndReason,
  PlaybackKpis,
  PlaybackTiming,
} from "../application/playback-controller.js";
import type { SongLibrary } from "../application/song-library.js";
import type { Track } from "../domain/track.js";
import { formatPlaybackError, formatPlaybackStarted } from "../lib/messages.js";
import { parseArtistTitle } from "../media/lyrics.js";
import type { MinimalLogger } from "../observability/logger.js";
import type { MetricsCollector } from "../observability/metrics.js";
import type { PlaybackMetrics } from "../observability/prometheus.js";

interface TrackTiming {
  readonly audioUrlMs?: number;
  readonly cacheHit?: boolean;
  readonly metadataMs?: number;
}

const MAX_TRACKED_TIMINGS = 200;

/** Resolution timings per track, logged with its start and end lines. */
export class TrackTimings {
  readonly #timings = new Map<string, TrackTiming>();

  get size(): number {
    return this.#timings.size;
  }

  get(trackId: string): TrackTiming | undefined {
    return this.#timings.get(trackId);
  }

  /**
   * Metadata and audio-URL timings arrive separately for the same track;
   * merge so the second report does not erase the first.
   */
  merge(trackId: string, timing: TrackTiming): void {
    this.#timings.set(trackId, { ...this.#timings.get(trackId), ...timing });
    if (this.#timings.size > MAX_TRACKED_TIMINGS) {
      const oldest = this.#timings.keys().next().value;
      if (oldest !== undefined) this.#timings.delete(oldest);
    }
  }

  take(trackId: string): TrackTiming | undefined {
    const timing = this.#timings.get(trackId);
    this.#timings.delete(trackId);
    return timing;
  }
}

export interface PlaybackEventsOptions {
  readonly logger: MinimalLogger;
  readonly listeningHistory: Pick<
    ListeningHistory,
    "recordFinish" | "recordStart"
  >;
  readonly songLibrary: Pick<SongLibrary, "record">;
  readonly metrics: Pick<
    MetricsCollector,
    "increment" | "recordError" | "recordTiming"
  >;
  readonly playbackMetrics: Pick<PlaybackMetrics, "record">;
  readonly sendChannelMessage: (text: string) => Promise<void>;
  /** Marks that playback started; true the first time since startup. */
  readonly markStarted: () => boolean;
  readonly timings?: TrackTimings;
}

export interface PlaybackEvents {
  readonly onPlaybackStarted: (track: Track) => Promise<void>;
  readonly onPlaybackFinished: (
    track: Track,
    metrics: AudioPlayerMetrics,
    reason: PlaybackEndReason,
    kpis?: PlaybackKpis,
  ) => void;
  readonly onTiming: (timing: PlaybackTiming) => void;
  readonly onPlaybackError: (track: Track, error: Error) => Promise<void>;
}

/** The playback service's callbacks: logs, history, metrics, chat. */
export function createPlaybackEvents(
  options: PlaybackEventsOptions,
): PlaybackEvents {
  const { listeningHistory, logger, metrics, songLibrary } = options;
  const timings = options.timings ?? new TrackTimings();
  return {
    onPlaybackStarted: async (track) => {
      logger.info(
        { ...timings.get(track.id), trackId: track.id, title: track.title },
        "Playback started",
      );
      listeningHistory.recordStart(track.requestedByUid ?? track.requestedBy, {
        id: track.id,
        title: track.title,
      });
      // Endless radio streams are not songs themselves; their songs enter
      // the library through the scrobbler once the station names them.
      if (track.durationSeconds !== undefined) {
        const { artist } = parseArtistTitle(track.title);
        songLibrary.record({
          ...(artist === undefined ? {} : { artist }),
          id: track.id,
          source: track.source,
          title: track.title,
        });
      }
      const isFirst = options.markStarted();
      await options.sendChannelMessage(
        track.requestedByUid === AUTOPLAY_UID
          ? `Autoplay: ${track.title}`
          : formatPlaybackStarted(track.title, isFirst),
      );
    },
    onPlaybackFinished: (track, playerMetrics, reason, kpis) => {
      options.playbackMetrics.record(reason, playerMetrics, kpis);
      logger.info(
        {
          ...timings.take(track.id),
          ...playerMetrics,
          ...kpis,
          reason,
          trackId: track.id,
          title: track.title,
        },
        "Playback session",
      );
      listeningHistory.recordFinish(
        track.requestedByUid ?? track.requestedBy,
        { id: track.id, title: track.title },
        reason === "completed",
      );
    },
    onTiming: (timing) => {
      timings.merge(timing.trackId, {
        ...(timing.stage === "metadata"
          ? { metadataMs: timing.durationMs }
          : {}),
        ...(timing.stage === "audio-url"
          ? {
              audioUrlMs: timing.durationMs,
              ...(timing.cacheHit === undefined
                ? {}
                : { cacheHit: timing.cacheHit }),
            }
          : {}),
      });
      if (timing.stage === "audio-url") {
        const status = timing.prefetchStatus;
        if (status === "hit") metrics.increment("prefetchHits");
        else if (status === "in-flight") metrics.increment("prefetchInFlight");
        else if (status === "miss") metrics.increment("prefetchMisses");
      }
      metrics.recordTiming(timing);
      logger.info(timing, "Playback timing");
    },
    onPlaybackError: async (track, error) => {
      metrics.recordError(track.id, error, track.title);
      logger.error(
        { err: error, trackId: track.id },
        "YouTube playback failed",
      );
      await options.sendChannelMessage(formatPlaybackError(track.title));
    },
  };
}
