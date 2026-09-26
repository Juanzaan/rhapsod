import type { Track } from "../domain/track.js";
import type { SerializedQueueTrack } from "../domain/state-store.js";
import {
  createPcmStream,
  playFfmpegUrl,
  type FfmpegPlaybackSession,
} from "../audio/ffmpeg-player.js";
import {
  isForbiddenResponse,
  type FfmpegPcmStream,
} from "../audio/ffmpeg-pcm.js";
import type { RhapsodOpusEncoder } from "../audio/opus-encoder.js";
import { FRAME_DURATION_MS } from "../audio/opus-encoder.js";
import {
  isMidPlayStall,
  type AudioPlayerMetrics,
  type VoiceFrameOutput,
} from "../audio/audio-player.js";
import type { LoudnessProfiler } from "../audio/loudness-profiler.js";
import type { YoutubeTrackMetadata } from "../media/youtube/yt-dlp.js";
import type { DirectUrlResolver } from "../media/direct-url.js";
import type { SoundCloudResolver } from "../media/soundcloud/public-api.js";
import type {
  AudioUrlSource,
  PrefetchStatus,
} from "../observability/metrics.js";
import { UserError } from "../lib/user-error.js";
import {
  lastsThroughPlay,
  type PreparedAudioStore,
} from "./prepared-audio-store.js";
import { PlaybackEpoch } from "./playback-epoch.js";
import type { TrackQueue } from "./track-queue.js";

export type LoopMode = "off" | "queue" | "track";

export function volumeToGain(percent: number): number {
  return 10 ** ((percent - 100) * 0.02);
}

export type PlaybackDriverState = "idle" | "resolving" | "playing";

export type PlaybackEndReason = "completed" | "error" | "skipped" | "stopped";

// Internal end reason for a session replaced by another session of the same
// track (seek, 403 retry); never reported to observers.
type SessionEndReason = PlaybackEndReason | "restart";

/**
 * Per-play latency, reported once when a play ends (restarts of the same
 * play for seek or a 403 do not count as new starts).
 * - startDelayMs: from the driver picking the track to its first audio frame
 *   (resolution, ffmpeg startup and buffering).
 * - handoffGapMs: from the previous track's end to this track's first frame,
 *   the silence listeners hear; absent after the driver sat idle.
 */
export interface PlaybackKpis {
  readonly coldStart: boolean;
  readonly handoffGapMs?: number;
  readonly prewarmed: boolean;
  readonly startDelayMs?: number;
}

interface PlayStart {
  readonly createdAt: number;
  readonly pickedAt: number;
  readonly player: { readonly metrics: AudioPlayerMetrics };
  readonly prewarmed: boolean;
  readonly previousEndedAt: number | undefined;
}

export interface PlaybackTiming {
  readonly audioUrlSource?: AudioUrlSource;
  readonly cacheHit?: boolean;
  readonly durationMs: number;
  readonly prefetchStatus?: PrefetchStatus;
  readonly stage: "metadata" | "audio-url";
  readonly trackId: string;
}

// The slice of URL resolution the driver needs. The full intake resolver
// satisfies this structurally; the driver never searches libraries.
export interface PlaybackAudioResolver {
  getAudioUrlFromUrl(url: string, signal?: AbortSignal): Promise<string>;
  invalidateAudioUrl?(url: string): Promise<boolean>;
  search(
    query: string,
    expectedDurationSeconds?: number,
    expectedTitle?: string,
  ): Promise<YoutubeTrackMetadata>;
}

export interface PlaybackControllerOptions {
  readonly encoder: RhapsodOpusEncoder;
  readonly output: VoiceFrameOutput;
  readonly queue: TrackQueue;
  readonly preparedStore: PreparedAudioStore;
  readonly resolver: PlaybackAudioResolver;
  readonly directUrlResolver?: DirectUrlResolver;
  readonly soundcloudResolver?: SoundCloudResolver;
  readonly createPlayback?: typeof playFfmpegUrl;
  readonly createPcmStream?: typeof createPcmStream;
  readonly proxyUrl?: string;
  readonly prewarmNext?: boolean;
  readonly loudnessProfiler?: LoudnessProfiler;
  readonly onPlaybackError?: (
    track: Track,
    error: Error,
  ) => void | Promise<void>;
  readonly onPlaybackStarted?: (track: Track) => void | Promise<void>;
  readonly onPlaybackFinished?: (
    track: Track,
    metrics: AudioPlayerMetrics,
    reason: PlaybackEndReason,
    kpis?: PlaybackKpis,
  ) => void;
  readonly onTiming?: (timing: PlaybackTiming) => void;
  readonly onStateChanged?: () => void;
  readonly autoplayProvider?: () => Promise<Track | undefined>;
  readonly autoplayTimeoutMs?: number;
  readonly initialAutoplay?: boolean;
  readonly initialVolumePercent?: number;
  readonly initialLoopMode?: LoopMode;
  readonly persistedQueue?: readonly SerializedQueueTrack[];
}

const AUDIO_URL_REFRESH_AHEAD_MS = 3 * 60_000;
const AUTH_REQUIRED_RE =
  /sign in to confirm|cookies for the authentication|request you to sign in|login required/i;
const MAX_AUDIO_URL_403_RETRIES = 3;
// A source that stops delivering mid-song (throttled CDN, dropped radio
// connection) used to end the track as an error and skip it. One resume per
// play gets it back; a second stall in the same play is treated as dead.
const MAX_STALL_RESUMES_PER_PLAY = 1;
const PREFETCH_STABILITY_TIMEOUT_MS = 8_000;
const PREFETCH_STABILITY_POLL_MS = 100;
const PREWARM_CHECK_INTERVAL_MS = 2_000;
const PREFETCH_DEPTH = 6;
const PLAYLIST_PREFETCH_DEPTH = 8;
const PLAYLIST_PREFETCH_BATCH = 3;
const HISTORY_LIMIT = 20;

// Last-resort bound on a single track's URL resolution. Worst-case
// legitimate budget: innertube ~5s + daemon 15s + two local yt-dlp passes
// ~24s + API calls and fallbacks — comfortably under a minute. Past 90s
// something is wedged (a promise that will never settle), and without this
// the driver loop parks forever with the chain claimed: nothing plays until
// the process restarts.
const RESOLVE_WATCHDOG_MS = 90_000;
// Upper bound for one autoplay pick (mix expansion over up to 3 seeds plus
// the related fallback). Past this the driver parks instead of holding the
// chain on a wedged resolution with a stale "playing" state.
const AUTOPLAY_WATCHDOG_MS = 60_000;

// Playback state machine extracted from YoutubePlaybackService: the driver
// loop, transport controls, prefetch/prewarm and loop/history bookkeeping.
// Queue storage, intake (enqueue/playlist expansion) and persistence stay
// with the service, which drives this controller and persists on its
// onStateChanged hook.
export class PlaybackController {
  readonly #encoder: RhapsodOpusEncoder;
  readonly #output: VoiceFrameOutput;
  readonly #queue: TrackQueue;
  readonly #preparedStore: PreparedAudioStore;
  readonly #resolver: PlaybackAudioResolver;
  readonly #directUrlResolver: DirectUrlResolver | undefined;
  readonly #soundcloudResolver: SoundCloudResolver | undefined;
  readonly #createPlayback: typeof playFfmpegUrl;
  readonly #createPcmStream: typeof createPcmStream;
  readonly #proxyUrl: string | undefined;
  readonly #prewarmEnabled: boolean;
  readonly #loudnessProfiler: LoudnessProfiler | undefined;
  readonly #onPlaybackError: (
    track: Track,
    error: Error,
  ) => void | Promise<void>;
  readonly #onPlaybackStarted: (track: Track) => void | Promise<void>;
  readonly #onPlaybackFinished: (
    track: Track,
    metrics: AudioPlayerMetrics,
    reason: PlaybackEndReason,
    kpis?: PlaybackKpis,
  ) => void;
  readonly #onTiming: (timing: PlaybackTiming) => void;
  readonly #playStarts = new WeakMap<Track, PlayStart>();
  // When the last session ended while more was queued; cleared when the
  // driver goes idle so a start after silence counts as cold, not a gap.
  #lastSessionEndedAt: number | undefined;
  readonly #onStateChanged: () => void;
  readonly #autoplayProvider: (() => Promise<Track | undefined>) | undefined;
  readonly #autoplayTimeoutMs: number;
  #autoplay = false;
  #autoplayArmed = true;
  readonly #epochs = new PlaybackEpoch();
  #persistedQueue: readonly SerializedQueueTrack[];
  #current: Track | undefined;
  #session: FfmpegPlaybackSession | undefined;
  #chainActive = false;
  // Explicit driver state for observability and the resolve watchdog.
  // Deliberately coarse: idle (parked or stopped), resolving (track claimed,
  // URL not yet in hand), playing (live session). Transient windows (a skip
  // landing between sessions) resolve themselves within one loop turn.
  #driverState: PlaybackDriverState = "idle";
  // Set when the current track restarts in a new ffmpeg session (seek,
  // 403 retry). The next session for that track resumes the
  // same play: it is not counted, announced or recorded again. `seconds` is
  // absent for live streams, which rejoin at the live edge.
  #pendingResume:
    { readonly seconds?: number; readonly trackId: string } | undefined;
  // Track position where the current session started; framesSent counts
  // from zero in every session.
  #sessionOffsetMs = 0;
  // A play whose session was replaced by a restart and whose finish is
  // therefore not reported yet. The resumed session reports it; if the
  // resume never plays (skip, stop, resolution failure) it is reported here.
  #unfinished:
    { readonly track: Track; readonly metrics: AudioPlayerMetrics } | undefined;
  #pendingSkips = 0;
  #volumePercent = 50;
  #tracksPlayed = 0;
  readonly #history: Track[] = [];
  #loopMode: LoopMode = "off";
  #loopPool: Track[] = [];
  #warmStream:
    { readonly source: string; readonly stream: FfmpegPcmStream } | undefined;
  readonly #sessionEndReasons = new WeakMap<
    FfmpegPlaybackSession,
    SessionEndReason
  >();
  readonly #retries = new WeakMap<Track, number>();
  readonly #stallResumes = new WeakMap<Track, number>();

  constructor(options: PlaybackControllerOptions) {
    this.#encoder = options.encoder;
    this.#output = options.output;
    this.#queue = options.queue;
    this.#preparedStore = options.preparedStore;
    this.#resolver = options.resolver;
    this.#directUrlResolver = options.directUrlResolver;
    this.#soundcloudResolver = options.soundcloudResolver;
    this.#createPlayback = options.createPlayback ?? playFfmpegUrl;
    this.#createPcmStream = options.createPcmStream ?? createPcmStream;
    this.#proxyUrl = options.proxyUrl;
    this.#prewarmEnabled = options.prewarmNext ?? false;
    this.#loudnessProfiler = options.loudnessProfiler;
    this.#onPlaybackError = options.onPlaybackError ?? (() => undefined);
    this.#onPlaybackStarted = options.onPlaybackStarted ?? (() => undefined);
    this.#onPlaybackFinished = options.onPlaybackFinished ?? (() => undefined);
    this.#onTiming = options.onTiming ?? (() => undefined);
    this.#onStateChanged = options.onStateChanged ?? (() => undefined);
    this.#autoplayProvider = options.autoplayProvider;
    this.#autoplayTimeoutMs = options.autoplayTimeoutMs ?? AUTOPLAY_WATCHDOG_MS;
    this.#autoplay = options.initialAutoplay ?? false;
    if (options.initialVolumePercent !== undefined) {
      this.#volumePercent = options.initialVolumePercent;
    }
    if (options.initialLoopMode !== undefined) {
      this.#loopMode = options.initialLoopMode;
    }
    this.#persistedQueue = options.persistedQueue ?? [];
  }

  get current(): Track | undefined {
    return this.#current;
  }

  captureStopEpoch(): number {
    return this.#epochs.captureStopEpoch();
  }

  isStopEpochCurrent(stopEpoch: number): boolean {
    return this.#epochs.isStopEpochCurrent(stopEpoch);
  }

  get tracksPlayed(): number {
    return this.#tracksPlayed;
  }

  get volume(): number {
    return this.#volumePercent;
  }

  setVolume(percent: number): void {
    this.#volumePercent = Math.max(0, Math.min(100, Math.round(percent)));
    this.#session?.player.setVolume(volumeToGain(this.#volumePercent));
    this.#onStateChanged();
  }

  get loopMode(): LoopMode {
    return this.#loopMode;
  }

  get playerState(): "idle" | "buffering" | "playing" | "paused" {
    // No session yet means the driver is resolving: previously reported as
    // idle, which told owners "nothing happening" during long resolutions.
    if (this.#driverState === "resolving") return "buffering";
    return this.#session?.player.state ?? "idle";
  }

  get driverState(): PlaybackDriverState {
    return this.#driverState;
  }

  get playbackPositionMs(): number {
    const session = this.#session;
    if (session === undefined) return 0;
    return this.#sessionPositionMs(session);
  }

  #sessionPositionMs(session: FfmpegPlaybackSession): number {
    return Math.max(
      0,
      this.#sessionOffsetMs +
        session.player.metrics.framesSent * FRAME_DURATION_MS,
    );
  }

  #reportUnfinished(reason: PlaybackEndReason): void {
    const unfinished = this.#unfinished;
    if (unfinished === undefined) return;
    this.#unfinished = undefined;
    const kpis = this.#takeKpis(unfinished.track);
    this.#safeObserver(() =>
      this.#onPlaybackFinished(
        unfinished.track,
        unfinished.metrics,
        reason,
        kpis,
      ),
    );
  }

  #takeKpis(track: Track): PlaybackKpis | undefined {
    const start = this.#playStarts.get(track);
    if (start === undefined) return undefined;
    this.#playStarts.delete(track);
    const delay = start.player.metrics.firstFrameDelayMs;
    const firstFrameAt =
      delay === undefined ? undefined : start.createdAt + delay;
    return {
      coldStart: start.previousEndedAt === undefined,
      prewarmed: start.prewarmed,
      ...(firstFrameAt === undefined
        ? {}
        : { startDelayMs: firstFrameAt - start.pickedAt }),
      ...(firstFrameAt === undefined || start.previousEndedAt === undefined
        ? {}
        : { handoffGapMs: firstFrameAt - start.previousEndedAt }),
    };
  }

  /** Resume point for a restart of the current track; undefined when live. */
  #resumeSeconds(track: Track, positionMs: number): number | undefined {
    if (track.durationSeconds === undefined) return undefined;
    return Math.floor(positionMs / 1_000);
  }

  get audioHealth(): AudioPlayerMetrics | undefined {
    return this.#session?.player.metrics;
  }

  setLoopMode(mode: LoopMode): void {
    this.#loopMode = mode;
    this.#loopPool = mode === "queue" ? [...this.#queue.snapshot()] : [];
    this.#onStateChanged();
  }

  /**
   * Replaces the current session with a new one for the same track. The
   * interrupted session is not reported as finished: the listener did not
   * skip anything, the same play continues.
   */
  #restartCurrent(seconds: number | undefined): void {
    const track = this.#current;
    if (!track) return;
    this.#pendingResume = {
      ...(seconds === undefined ? {} : { seconds }),
      trackId: track.id,
    };
    this.#epochs.invalidatePlayback();
    if (this.#session) {
      this.#sessionEndReasons.set(this.#session, "restart");
      this.#unfinished = { track, metrics: this.#session.player.metrics };
      this.#session.stop();
      this.#session = undefined;
    }
    try {
      this.#queue.requeue(track);
      this.#queue.moveToHead(track.id);
    } catch {
      // Duplicate already queued: the restart acts like a skip.
    }
    this.requestNext();
  }

  history(): readonly Track[] {
    return [...this.#history];
  }

  #recordHistory(track: Track): void {
    this.#history.unshift(track);
    if (this.#history.length > HISTORY_LIMIT)
      this.#history.length = HISTORY_LIMIT;
  }

  restoreQueuedTracks(connectedUids: readonly string[]): number {
    const connected = new Set(connectedUids);
    let restored = 0;
    for (const entry of this.#persistedQueue) {
      if (entry.requestedByUid === undefined) continue;
      if (!connected.has(entry.requestedByUid)) continue;
      if (this.#queue.length >= this.#queue.maxTracks) break;
      try {
        this.#queue.requeue({
          ...(entry.durationSeconds === undefined
            ? {}
            : { durationSeconds: entry.durationSeconds }),
          id: entry.id,
          requestedBy: entry.requestedBy,
          requestedByUid: entry.requestedByUid,
          ...(entry.searchQuery === undefined
            ? {}
            : { searchQuery: entry.searchQuery }),
          source: entry.source,
          title: entry.title,
        });
        restored++;
      } catch {
        // Skip duplicate entries from a stale persisted queue.
      }
    }
    this.#persistedQueue = [];
    if (this.#loopMode === "queue") {
      this.#loopPool = [...this.#queue.snapshot()];
    }
    if (restored > 0 && !this.#current) {
      this.prefetchNext();
      this.requestNext();
    } else if (restored > 0 && this.isSessionStable()) {
      this.prefetchNext();
    }
    return restored;
  }

  skip(): void {
    this.#epochs.invalidatePlayback();
    this.#pendingSkips++;
    this.#pendingResume = undefined;
    this.#reportUnfinished("skipped");
    // Keep a warm stream that matches the next queue head: a skip is exactly
    // the moment the prewarmed stream pays off. #takeWarmStream discards it
    // safely at handoff time if the head changed instead.
    if (this.#current) this.#preparedStore.invalidate(this.#current.source);
    if (this.#session) this.#sessionEndReasons.set(this.#session, "skipped");
    this.#session?.stop();
    this.#session = undefined;
    this.requestNext();
  }

  jumpTo(position: number): void {
    if (!Number.isSafeInteger(position) || position < 1) {
      throw new UserError("Usá: !jump <posición>");
    }
    if (position > this.#queue.length) {
      throw new UserError("No existe esa posición en la cola.");
    }
    this.#epochs.invalidatePlayback();
    this.#pendingSkips += position - 1 + (this.#current === undefined ? 0 : 1);
    this.#pendingResume = undefined;
    this.#reportUnfinished("skipped");
    if (this.#current) this.#preparedStore.invalidate(this.#current.source);
    if (this.#session) this.#sessionEndReasons.set(this.#session, "skipped");
    this.#session?.stop();
    this.#session = undefined;
    this.requestNext();
  }

  get autoplayEnabled(): boolean {
    return this.#autoplay;
  }

  setAutoplayEnabled(enabled: boolean): void {
    this.#autoplay = enabled;
    if (enabled) this.#autoplayArmed = true;
    this.#onStateChanged();
    if (enabled) this.requestNext();
  }

  stop(): void {
    this.#epochs.resetAll();
    this.#autoplayArmed = false;
    this.#pendingSkips = 0;
    this.#pendingResume = undefined;
    this.#reportUnfinished("stopped");
    this.#discardWarmStream();
    if (this.#session) this.#sessionEndReasons.set(this.#session, "stopped");
    this.#session?.stop();
    this.#session = undefined;
    this.#current = undefined;
    this.#driverState = "idle";
    this.#lastSessionEndedAt = undefined;
    this.#loopMode = "off";
    this.#loopPool = [];
  }

  resetQueueState(): void {
    this.#epochs.resetAll();
    this.#autoplayArmed = false;
    this.#pendingSkips = 0;
    this.#pendingResume = undefined;
    this.#reportUnfinished("stopped");
    this.#discardWarmStream();
    this.#loopMode = "off";
    this.#loopPool = [];
  }

  seek(seconds: number): void {
    if (!this.#current || !this.#session) {
      throw new UserError(
        "No hay nada reproduciéndose para saltar de posición.",
      );
    }
    let target = Math.max(0, Math.floor(seconds));
    if (this.#current.durationSeconds !== undefined) {
      target = Math.min(target, Math.max(0, this.#current.durationSeconds - 1));
    }
    this.#restartCurrent(target);
  }

  replayPrevious(): Track {
    const previous = this.#history[this.#current ? 1 : 0];
    if (!previous) {
      throw new UserError("No hay ninguna canción anterior para repetir.");
    }
    try {
      this.#queue.requeue(previous);
    } catch {
      // Already queued: move it to the front instead.
    }
    this.#queue.moveToHead(previous.id);
    this.requestNext();
    this.#onStateChanged();
    return previous;
  }

  pause(): void {
    this.#session?.player.pause();
  }

  resume(): void {
    this.#session?.player.resume();
  }

  requestNext(): void {
    if (this.#chainActive) return;
    void this.#playNext();
  }

  async #maybeAutoplay(): Promise<boolean> {
    if (
      !this.#autoplay ||
      !this.#autoplayArmed ||
      this.#autoplayProvider === undefined
    ) {
      return false;
    }
    const stopEpoch = this.#epochs.captureStopEpoch();
    this.#driverState = "resolving";
    this.#onStateChanged();
    const picked = await Promise.race([
      this.#autoplayProvider().catch(() => undefined),
      new Promise<undefined>((resolve) => {
        const timer = setTimeout(
          () => resolve(undefined),
          this.#autoplayTimeoutMs,
        );
        timer.unref();
      }),
    ]);
    if (
      picked === undefined ||
      !this.#autoplay ||
      !this.#epochs.isStopEpochCurrent(stopEpoch)
    ) {
      return false;
    }
    try {
      this.#queue.requeue(picked);
    } catch {
      return this.#queue.length > 0;
    }
    return true;
  }

  async #playNext(): Promise<void> {
    if (this.#chainActive) return;
    this.#chainActive = true;
    try {
      for (;;) {
        if (this.#pendingSkips > 0) {
          const toDrop =
            this.#pendingSkips - (this.#current === undefined ? 0 : 1);
          this.#pendingSkips = 0;
          for (let i = 0; i < toDrop; i++) {
            const dropped = this.#queue.next();
            if (dropped) this.#preparedStore.invalidate(dropped.source);
          }
        }
        if (this.#queue.length === 0 && this.#loopPool.length > 0) {
          for (const pooled of this.#loopPool) {
            try {
              this.#queue.requeue(pooled);
            } catch {
              // already queued; skip
            }
          }
          this.#loopPool = [];
        }
        const track = this.#queue.next();
        if (!track) {
          if (await this.#maybeAutoplay()) continue;
          // Lost-wakeup guard: an enqueue that landed while the provider ran
          // no-ops on the claimed chain, so re-check before parking.
          if (this.#queue.length > 0) continue;
          this.#current = undefined;
          this.#driverState = "idle";
          this.#lastSessionEndedAt = undefined;
          this.#onStateChanged();
          return;
        }
        const generation = this.#epochs.nextGeneration();
        this.#current = track;
        this.#driverState = "resolving";
        this.#onStateChanged();
        const audioResolutionStartedAt = Date.now();
        // A resolution that never settles wedges the whole driver loop:
        // chainActive stays claimed, requestNext() no-ops, and nothing plays
        // until the process restarts. Race it against a last-resort bound and
        // treat a wedged track like a failed one. Promise.race subscribes to
        // the abandoned promise, so its eventual settlement is safely ignored.
        const resolved = await Promise.race([
          this.#resolveOrSkip(track, generation),
          new Promise<undefined>((_, reject) => {
            const timer = setTimeout(() => {
              reject(
                new Error(
                  `Audio resolution timed out after ${RESOLVE_WATCHDOG_MS / 1_000}s; skipping track`,
                ),
              );
            }, RESOLVE_WATCHDOG_MS);
            timer.unref();
          }),
        ]).catch((error: unknown) => {
          // Only the watchdog above can reject here: #resolveOrSkip never
          // throws by contract (it reports and returns undefined instead).
          this.#reportPlaybackError(track, error);
          this.#preparedStore.drop(track.source);
          return undefined;
        });
        if (resolved === undefined) {
          if (this.#pendingResume?.trackId === track.id) {
            this.#pendingResume = undefined;
            this.#reportUnfinished("error");
          }
          continue;
        }
        this.#safeObserver(() => {
          this.#onTiming({
            audioUrlSource: resolved.audioUrlSource,
            cacheHit: resolved.cacheHit,
            durationMs: Date.now() - audioResolutionStartedAt,
            prefetchStatus: resolved.prefetchStatus,
            stage: "audio-url",
            trackId: track.id,
          });
        });
        const pendingResume = this.#pendingResume;
        this.#pendingResume = undefined;
        const resuming = pendingResume?.trackId === track.id;
        // A different track taking over means the restarted play was
        // abandoned (for example the restart could not requeue it).
        if (!resuming) this.#reportUnfinished("skipped");
        const seekSeconds = resuming ? pendingResume?.seconds : undefined;
        const playbackOptions: {
          readonly seekSeconds?: number;
          readonly live?: boolean;
          readonly stream?: FfmpegPcmStream;
          readonly loudnessTargetLufs?: number;
          readonly loudnessProfile?: {
            readonly measuredI: number;
            readonly measuredLra: number;
            readonly measuredThresh: number;
            readonly measuredTp: number;
          };
        } = {
          ...(seekSeconds === undefined ? {} : { seekSeconds }),
          ...(track.durationSeconds === undefined ? { live: true } : {}),
          // Live radio has no measured profile, so it used to play through
          // dynamic single-pass loudnorm forever: the gain rides audibly on
          // an endless pre-mastered broadcast chain (pumping, squashed
          // transients). Finite tracks keep measured two-pass normalization;
          // live streams pass through at station level, !volume still applies.
          ...(this.#loudnessProfiler === undefined ||
          track.durationSeconds === undefined
            ? {}
            : {
                loudnessTargetLufs: this.#loudnessProfiler.targetLufs,
                ...(() => {
                  const profile = this.#loudnessProfiler.cached(track.source);
                  return profile === undefined
                    ? {}
                    : { loudnessProfile: profile };
                })(),
              }),
        };
        let session: FfmpegPlaybackSession;
        let prewarmed = false;
        const createdAt = Date.now();
        try {
          if (seekSeconds === undefined) {
            const warm = this.#takeWarmStream(track.source);
            prewarmed = warm !== undefined;
            if (warm !== undefined) {
              session = this.#createPlayback(
                resolved.url,
                this.#encoder,
                this.#output,
                { ...playbackOptions, stream: warm },
              );
            } else {
              session = this.#createPlayback(
                resolved.url,
                this.#encoder,
                this.#output,
                playbackOptions,
              );
            }
          } else {
            this.#discardWarmStream();
            session = this.#createPlayback(
              resolved.url,
              this.#encoder,
              this.#output,
              playbackOptions,
            );
          }
        } catch (error) {
          this.#reportPlaybackError(track, error);
          this.#preparedStore.drop(track.source);
          if (resuming) this.#reportUnfinished("error");
          continue;
        }
        session.player.setVolume(volumeToGain(this.#volumePercent));
        this.#session = session;
        this.#sessionOffsetMs = (seekSeconds ?? 0) * 1_000;
        this.#autoplayArmed = true;
        this.#driverState = "playing";
        if (resuming) {
          // The resumed session reports the finish from here on.
          this.#unfinished = undefined;
        } else {
          this.#playStarts.set(track, {
            createdAt,
            pickedAt: audioResolutionStartedAt,
            player: session.player,
            prewarmed,
            previousEndedAt: this.#lastSessionEndedAt,
          });
          this.#tracksPlayed++;
          this.#recordHistory(track);
          this.#safeObserver(() => this.#onPlaybackStarted(track));
        }
        this.#prefetchWhenStable();
        let playbackError: unknown;
        try {
          await session.done;
        } catch (error) {
          playbackError = error;
        }
        this.#lastSessionEndedAt = Date.now();
        const endReason =
          this.#sessionEndReasons.get(session) ??
          (playbackError !== undefined ? "error" : "completed");
        if (endReason === "restart") continue;
        const retries = this.#retries.get(track) ?? 0;
        const stallResumes = this.#stallResumes.get(track) ?? 0;
        const forbidden =
          playbackError instanceof Error &&
          endReason === "error" &&
          isForbiddenResponse(playbackError.message) &&
          retries < MAX_AUDIO_URL_403_RETRIES;
        const stalled =
          !forbidden &&
          playbackError instanceof Error &&
          endReason === "error" &&
          isMidPlayStall(playbackError.message) &&
          stallResumes < MAX_STALL_RESUMES_PER_PLAY;
        if (forbidden || stalled) {
          if (forbidden) this.#retries.set(track, retries + 1);
          else this.#stallResumes.set(track, stallResumes + 1);
          const positionMs = this.#sessionPositionMs(session);
          // Resolve again on resume: a stalled googlevideo URL is often
          // throttled or near expiry, and a 403'd one is dead.
          this.#preparedStore.drop(track.source);
          // Invalidate stale URL (daemon may have cached a 403'd host).
          // Awaited on purpose: the requeued track's re-resolve can reach
          // the daemon before a fire-and-forget invalidate lands, and the
          // daemon would serve the same dead URL again — burning ~10-25s
          // of dead air and a retry on a URL already known bad.
          if (forbidden) {
            await this.#resolver
              .invalidateAudioUrl?.(track.source)
              .catch(() => undefined);
          }
          if (
            this.#epochs.isGenerationCurrent(generation) &&
            this.#current === track
          ) {
            try {
              this.#queue.requeue(track);
              this.#queue.moveToHead(track.id);
              // The retry resumes the same play where the 403 or stall cut it:
              // no second "Reproduciendo", no error message, no restart
              // from the top.
              const seconds = this.#resumeSeconds(track, positionMs);
              this.#pendingResume = {
                ...(seconds === undefined ? {} : { seconds }),
                trackId: track.id,
              };
              this.#unfinished = { track, metrics: session.player.metrics };
              this.#session = undefined;
              this.#current = undefined;
              this.#onStateChanged();
              continue;
            } catch {
              // Already queued or limit reached: fall through
            }
          }
        }
        const kpis = this.#takeKpis(track);
        this.#safeObserver(() => {
          this.#onPlaybackFinished(
            track,
            session.player.metrics,
            endReason,
            kpis,
          );
        });
        if (playbackError !== undefined) {
          this.#reportPlaybackError(track, playbackError);
        }
        if (
          !this.#epochs.isGenerationCurrent(generation) ||
          this.#current !== track
        ) {
          continue;
        }
        this.#preparedStore.drop(track.source);
        this.#retries.delete(track);
        this.#session = undefined;
        this.#current = undefined;
        this.#onStateChanged();
        if (this.#loopMode === "track") {
          try {
            this.#queue.requeue(track);
          } catch {
            // already queued; skip
          }
        } else if (this.#loopMode === "queue") {
          this.#loopPool.push(track);
        }
      }
    } finally {
      this.#chainActive = false;
    }
  }

  async #resolveOrSkip(
    track: Track,
    generation: number,
  ): Promise<
    | {
        audioUrlSource: AudioUrlSource;
        cacheHit: boolean;
        prefetchStatus: PrefetchStatus;
        url: string;
      }
    | undefined
  > {
    const discardInFlight = (): undefined => {
      this.#preparedStore.invalidate(track.source);
      // A skip that landed while this track was resolving consumed this track.
      // Do not let that same skip drop an extra queued track in the next loop.
      if (this.#pendingSkips > 0) this.#pendingSkips--;
      return undefined;
    };
    try {
      const resolved = await this.#preparedStore.getOrResolve(
        track,
        "inline-resolve",
        (t, signal) => this.#resolvePlayableAudio(t, signal),
      );
      if (
        !this.#epochs.isGenerationCurrent(generation) ||
        this.#current !== track
      ) {
        return discardInFlight();
      }
      return resolved;
    } catch (error) {
      if (
        !this.#epochs.isGenerationCurrent(generation) ||
        this.#current !== track
      ) {
        return discardInFlight();
      }
      const playbackError =
        error instanceof Error ? error : new Error(String(error));
      this.#reportPlaybackError(track, playbackError);
      this.#preparedStore.invalidate(track.source);
      return undefined;
    }
  }

  #reportPlaybackError(track: Track, error: unknown): void {
    const playbackError =
      error instanceof Error ? error : new Error(String(error));
    this.#safeObserver(() => this.#onPlaybackError(track, playbackError));
  }

  #safeObserver(operation: () => void | Promise<void>): void {
    try {
      const result = operation();
      if (result instanceof Promise) {
        void result.catch(() => {
          // Observability callbacks must never break the playback chain.
        });
      }
    } catch {
      // Observability callbacks must never break the playback chain.
    }
  }

  async #resolvePlayableAudio(
    track: Track,
    signal?: AbortSignal,
  ): Promise<string> {
    if (track.searchQuery !== undefined) {
      const startedAt = Date.now();
      const metadata = await this.#resolver.search(
        track.searchQuery,
        track.durationSeconds,
        track.title,
      );
      this.#recordMetadataTiming(metadata, startedAt);
      const resolvedTrack: Track = {
        ...(track.alternativeProvider === undefined
          ? {}
          : { alternativeProvider: track.alternativeProvider }),
        ...(track.durationSeconds === undefined
          ? {}
          : { durationSeconds: track.durationSeconds }),
        ...(metadata.fallbackSources === undefined
          ? {}
          : { fallbackSources: metadata.fallbackSources }),
        id: track.id,
        requestedBy: track.requestedBy,
        ...(track.requestedByUid === undefined
          ? {}
          : { requestedByUid: track.requestedByUid }),
        source: metadata.webpageUrl,
        title: track.title,
      };
      return this.#resolvePlayableAudio(resolvedTrack, signal);
    }
    if (
      this.#directUrlResolver &&
      (await this.#directUrlResolver.match(track.source))
    ) {
      const url = await this.#directUrlResolver.getAudioUrl(track.source);
      // Persisted so a restart (and the runtime re-seed) skips re-resolution.
      this.#preparedStore.persist(track.source, url);
      return url;
    }
    if (this.#soundcloudResolver?.match(track.source)) {
      const url = await this.#soundcloudResolver.getAudioUrl(track.source);
      this.#preparedStore.persist(track.source, url);
      return url;
    }
    let lastError: unknown;
    try {
      const url = await this.#resolver.getAudioUrlFromUrl(track.source, signal);
      this.#preparedStore.persist(track.source, url);
      return url;
    } catch (error) {
      lastError = error;
    }
    const fallbacks = track.fallbackSources ?? [];
    if (fallbacks.length > 0) {
      const fallbackControllers = fallbacks.map(() => new AbortController());
      const fallbackSignals = fallbackControllers.map((controller) =>
        signal === undefined
          ? controller.signal
          : AbortSignal.any([signal, controller.signal]),
      );
      let remaining = fallbacks.length;
      const fallbackResult = await new Promise<{
        readonly source: string;
        readonly url: string;
      }>((resolve, reject) => {
        let settled = false;
        const abortAll = (): void => {
          for (const controller of fallbackControllers) controller.abort();
        };
        const rejectIfComplete = (error: unknown): void => {
          if (settled) return;
          remaining--;
          lastError = error;
          if (remaining === 0) {
            settled = true;
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        };
        for (const [index, source] of fallbacks.entries()) {
          void this.#resolver
            .getAudioUrlFromUrl(source, fallbackSignals[index])
            .then(
              (url) => {
                if (settled) return;
                settled = true;
                abortAll();
                resolve({ source, url });
              },
              (error: unknown) => rejectIfComplete(error),
            );
        }
        signal?.addEventListener(
          "abort",
          () => {
            if (settled) return;
            settled = true;
            abortAll();
            reject(new Error("Audio resolution aborted"));
          },
          { once: true },
        );
      }).catch((error: unknown) => {
        lastError = error;
        return undefined;
      });
      if (fallbackResult !== undefined) {
        this.#preparedStore.persist(fallbackResult.source, fallbackResult.url);
        return fallbackResult.url;
      }
    }
    if (lastError instanceof Error) {
      if (AUTH_REQUIRED_RE.test(lastError.message)) {
        throw new Error(
          "YouTube pidió autenticación: probablemente las cookies del bot estén vencidas.",
        );
      }
      throw lastError;
    }
    throw new Error("No se encontró audio reproducible para esa pista.");
  }

  #recordMetadataTiming(
    metadata: YoutubeTrackMetadata,
    startedAt: number,
  ): void {
    this.#safeObserver(() => {
      this.#onTiming({
        durationMs: Date.now() - startedAt,
        stage: "metadata",
        trackId: metadata.id,
      });
    });
  }

  prefetchNext(): void {
    const queueSnapshot = this.#queue.snapshot();
    const isPlaylist = queueSnapshot.length > 10;
    const prefetchDepth = isPlaylist ? PLAYLIST_PREFETCH_DEPTH : PREFETCH_DEPTH;
    const prefetchSlice = queueSnapshot.slice(0, prefetchDepth);

    const toResolve: Array<{ track: Track; index: number }> = [];
    for (const [index, next] of prefetchSlice.entries()) {
      const existing = this.#preparedStore.peek(next.source);
      if (existing !== undefined) {
        if (
          lastsThroughPlay(existing.expiresAt, next, AUDIO_URL_REFRESH_AHEAD_MS)
        ) {
          continue;
        }
        this.#preparedStore.invalidate(next.source);
      }
      toResolve.push({ track: next, index });
    }

    if (isPlaylist && toResolve.length > PLAYLIST_PREFETCH_BATCH) {
      const immediate = toResolve.slice(0, PLAYLIST_PREFETCH_BATCH);
      const deferred = toResolve.slice(PLAYLIST_PREFETCH_BATCH);
      const stopEpoch = this.#epochs.captureStopEpoch();
      const queueSnapshotIds = new Set(
        queueSnapshot.map((queued) => queued.id),
      );
      for (const { track } of immediate) {
        void this.#preparedStore
          .resolve(track, "prefetch", (t, signal) =>
            this.#resolvePlayableAudio(t, signal),
          )
          .catch(() => {
            this.#preparedStore.invalidate(track.source);
          });
      }
      setTimeout(() => {
        if (!this.#epochs.isStopEpochCurrent(stopEpoch)) return;
        for (const { track } of deferred) {
          if (!queueSnapshotIds.has(track.id)) continue;
          const stillPrepared = this.#preparedStore.peek(track.source);
          if (
            stillPrepared === undefined ||
            !lastsThroughPlay(
              stillPrepared.expiresAt,
              track,
              AUDIO_URL_REFRESH_AHEAD_MS,
            )
          ) {
            void this.#preparedStore
              .resolve(track, "prefetch", (t, signal) =>
                this.#resolvePlayableAudio(t, signal),
              )
              .catch(() => {
                this.#preparedStore.invalidate(track.source);
              });
          }
        }
      }, 2_000);
    } else {
      for (const { track } of toResolve) {
        void this.#preparedStore
          .resolve(track, "prefetch", (t, signal) =>
            this.#resolvePlayableAudio(t, signal),
          )
          .catch(() => {
            this.#preparedStore.invalidate(track.source);
          });
      }
    }
  }

  isSessionStable(): boolean {
    const session = this.#session;
    return session !== undefined && session.player.metrics.framesSent > 0;
  }

  #prefetchWhenStable(): void {
    const session = this.#session;
    if (!session) return;
    const startedAt = Date.now();
    const check = (): void => {
      if (this.#session !== session) return;
      if (
        session.player.metrics.framesSent > 0 ||
        Date.now() - startedAt >= PREFETCH_STABILITY_TIMEOUT_MS
      ) {
        this.prefetchNext();
        // The first frame is the earliest moment #prewarmNext's
        // framesSent === 0 guard can pass; the midpoint check inside still
        // decides when the warm stream actually starts. Re-checking on a
        // short timer keeps the handoff armed through the whole track
        // without prewarming long before it is needed.
        this.#schedulePrewarmCheck();
        return;
      }
      setTimeout(check, PREFETCH_STABILITY_POLL_MS);
    };
    check();
  }

  #schedulePrewarmCheck(): void {
    const session = this.#session;
    const current = this.#current;
    if (!session || !current) return;
    const check = (): void => {
      if (this.#session !== session || this.#current !== current) return;
      this.#prewarmNext();
      // Re-arm until the warm stream exists or the track changes; the
      // midpoint guard inside #prewarmNext does the actual gating.
      if (this.#warmStream === undefined) {
        setTimeout(check, PREWARM_CHECK_INTERVAL_MS);
      }
    };
    check();
  }

  #prewarmNext(): void {
    if (!this.#prewarmEnabled || this.#warmStream !== undefined) return;
    const session = this.#session;
    const current = this.#current;
    if (!session || !current) return;
    const next = this.#queue.snapshot()[0];
    if (!next || next.source === current.source) return;
    const framesSent = session.player.metrics.framesSent;
    if (framesSent === 0) return;
    const playedMs = framesSent * FRAME_DURATION_MS;
    const durationMs = current.durationSeconds
      ? current.durationSeconds * 1_000
      : undefined;
    // Prewarm only when the current track is past its midpoint or near its end,
    // so the next ffmpeg process is not idle for an entire long track.
    const halfwayMs = durationMs === undefined ? 30_000 : durationMs / 2;
    if (playedMs < halfwayMs) return;
    this.#startPrewarm(next);
  }

  #startPrewarm(next: Track): void {
    const stamp = this.#epochs.stamp();
    void this.#preparedStore
      .resolve(next, "inline-resolve", (t, signal) =>
        this.#resolvePlayableAudio(t, signal),
      )
      .then((url) => {
        if (!this.#epochs.isCurrent(stamp)) {
          return undefined;
        }
        // Measuring an endless stream would burn a 120s ffmpeg sample for a
        // profile live playback never uses (see the loudnorm bypass above).
        if (next.durationSeconds !== undefined) {
          this.#loudnessProfiler?.measure(next.source, url);
        }
        if (
          this.#current === undefined ||
          this.#queue.snapshot()[0]?.source !== next.source
        ) {
          return undefined;
        }
        // Option parity with the cold path (#playNext's playbackOptions
        // + main.ts wiring): without loudness here, warm-started tracks would
        // sound different from cold-started ones. Live streams skip loudness
        // on both paths.
        const loudnessProfile = this.#loudnessProfiler?.cached(next.source);
        const stream = this.#createPcmStream(url, {
          ...(next.durationSeconds === undefined ? { live: true } : {}),
          ...(this.#proxyUrl === undefined ? {} : { proxyUrl: this.#proxyUrl }),
          ...(this.#loudnessProfiler === undefined ||
          next.durationSeconds === undefined
            ? {}
            : {
                loudnessTargetLufs: this.#loudnessProfiler.targetLufs,
                ...(loudnessProfile === undefined ? {} : { loudnessProfile }),
              }),
        });
        this.#warmStream = { source: next.source, stream };
        return stream;
      })
      .catch(() => {
        // Prewarm is best-effort; playback falls back to the normal path.
      });
  }

  #takeWarmStream(source: string): FfmpegPcmStream | undefined {
    if (this.#warmStream === undefined || this.#warmStream.source !== source) {
      this.#discardWarmStream();
      return undefined;
    }
    const { stream } = this.#warmStream;
    this.#warmStream = undefined;
    return stream;
  }

  #discardWarmStream(): void {
    if (this.#warmStream === undefined) return;
    const { stream } = this.#warmStream;
    this.#warmStream = undefined;
    stream.stop();
  }
}
