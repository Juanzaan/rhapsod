import type { Track } from "../domain/track.js";
import type { SerializedQueueTrack } from "../domain/state-store.js";
import {
  createPcmStream,
  playFfmpegUrl,
  type FfmpegPlaybackSession,
} from "../audio/ffmpeg-player.js";
import type { FfmpegPcmStream } from "../audio/ffmpeg-pcm.js";
import type { RhapsodOpusEncoder } from "../audio/opus-encoder.js";
import { FRAME_DURATION_MS } from "../audio/opus-encoder.js";
import type {
  AudioPlayerMetrics,
  VoiceFrameOutput,
} from "../audio/audio-player.js";
import {
  isAudioFilter,
  type AudioFilter,
  type FilterParam,
} from "../audio/filter-chain.js";
import type { LoudnessProfiler } from "../audio/loudness-profiler.js";
import type { YoutubeTrackMetadata } from "../media/youtube/yt-dlp.js";
import type { DirectUrlResolver } from "../media/direct-url.js";
import type { SoundCloudResolver } from "../media/soundcloud/public-api.js";
import type {
  AudioUrlSource,
  PrefetchStatus,
} from "../observability/metrics.js";
import { UserError } from "../lib/user-error.js";
import type { PreparedAudioStore } from "./prepared-audio-store.js";
import { PlaybackEpoch } from "./playback-epoch.js";
import type { TrackQueue } from "./track-queue.js";

export type LoopMode = "off" | "queue" | "track";

export function volumeToGain(percent: number): number {
  return 10 ** ((percent - 100) * 0.02);
}

export type PlaybackDriverState = "idle" | "resolving" | "playing";

export type PlaybackEndReason =
  "completed" | "error" | "skipped" | "stopped" | "filter-change";

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
  ) => void;
  readonly onTiming?: (timing: PlaybackTiming) => void;
  readonly onStateChanged?: () => void;
  readonly initialVolumePercent?: number;
  readonly initialLoopMode?: LoopMode;
  readonly initialFilter?: string;
  readonly persistedQueue?: readonly SerializedQueueTrack[];
}

const AUDIO_URL_REFRESH_AHEAD_MS = 3 * 60_000;
const AUTH_REQUIRED_RE =
  /sign in to confirm|cookies for the authentication|request you to sign in|login required/i;
const MAX_AUDIO_URL_403_RETRIES = 3;
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
  ) => void;
  readonly #onTiming: (timing: PlaybackTiming) => void;
  readonly #onStateChanged: () => void;
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
  #pendingSeek:
    { readonly seconds: number; readonly trackId: string } | undefined;
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
    PlaybackEndReason
  >();
  readonly #retries = new WeakMap<Track, number>();
  #filter: AudioFilter = "off";
  #filterParam: FilterParam = {};

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
    if (options.initialVolumePercent !== undefined) {
      this.#volumePercent = options.initialVolumePercent;
    }
    if (options.initialLoopMode !== undefined) {
      this.#loopMode = options.initialLoopMode;
    }
    if (
      options.initialFilter !== undefined &&
      isAudioFilter(options.initialFilter)
    ) {
      this.#filter = options.initialFilter;
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

  get filter(): AudioFilter {
    return this.#filter;
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
    const frames = this.#session?.player.metrics.framesSent ?? 0;
    return Math.max(0, frames * FRAME_DURATION_MS);
  }

  get audioHealth(): AudioPlayerMetrics | undefined {
    return this.#session?.player.metrics;
  }

  setLoopMode(mode: LoopMode): void {
    this.#loopMode = mode;
    this.#loopPool = mode === "queue" ? [...this.#queue.snapshot()] : [];
    this.#onStateChanged();
  }

  setFilter(filter: AudioFilter, param?: FilterParam): void {
    const nextParam = filter === "off" ? {} : (param ?? {});
    if (
      filter === this.#filter &&
      nextParam.level === this.#filterParam.level &&
      nextParam.rate === this.#filterParam.rate
    ) {
      return;
    }
    this.#filter = filter;
    this.#filterParam = nextParam;
    this.#onStateChanged();
    if (this.#current && this.#session) {
      const positionMs =
        this.#session.player.metrics.framesSent * FRAME_DURATION_MS;
      this.#restartForFilterChange(Math.floor(positionMs / 1_000));
    }
  }

  #restartForFilterChange(seekSeconds: number): void {
    const track = this.#current;
    if (!track) return;
    this.#pendingSeek = { seconds: seekSeconds, trackId: track.id };
    this.#epochs.invalidatePlayback();
    if (this.#session) {
      this.#sessionEndReasons.set(this.#session, "filter-change");
      this.#session.stop();
      this.#session = undefined;
    }
    try {
      this.#queue.requeue(track);
      this.#queue.moveToHead(track.id);
    } catch {
      // Duplicate already queued: the filter change acts like a restart.
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
    this.#pendingSeek = undefined;
    // Keep a warm stream that matches the next queue head: a skip is exactly
    // the moment the prewarmed stream pays off. #takeWarmStream discards it
    // safely at handoff time if the head changed instead.
    if (this.#current) this.#preparedStore.invalidate(this.#current.source);
    if (this.#session) this.#sessionEndReasons.set(this.#session, "skipped");
    this.#session?.stop();
    this.#session = undefined;
    this.requestNext();
  }

  stop(): void {
    this.#epochs.resetAll();
    this.#pendingSkips = 0;
    this.#pendingSeek = undefined;
    this.#discardWarmStream();
    if (this.#session) this.#sessionEndReasons.set(this.#session, "stopped");
    this.#session?.stop();
    this.#session = undefined;
    this.#current = undefined;
    this.#driverState = "idle";
    this.#loopMode = "off";
    this.#loopPool = [];
  }

  resetQueueState(): void {
    this.#epochs.resetAll();
    this.#pendingSkips = 0;
    this.#pendingSeek = undefined;
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
    this.#pendingSeek = { seconds: target, trackId: this.#current.id };
    this.#epochs.invalidatePlayback();
    if (this.#session) this.#sessionEndReasons.set(this.#session, "skipped");
    this.#session?.stop();
    this.#session = undefined;
    try {
      this.#queue.requeue(this.#current);
      this.#queue.moveToHead(this.#current.id);
    } catch {
      // Duplicate already queued: the seek acts like a skip.
    }
    this.requestNext();
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
          this.#current = undefined;
          this.#driverState = "idle";
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
          if (this.#pendingSeek?.trackId === track.id) {
            this.#pendingSeek = undefined;
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
        const pendingSeek = this.#pendingSeek;
        this.#pendingSeek = undefined;
        const seekSeconds =
          pendingSeek !== undefined && pendingSeek.trackId === track.id
            ? pendingSeek.seconds
            : undefined;
        const playbackOptions: {
          readonly seekSeconds?: number;
          readonly audioFilter: {
            readonly name: AudioFilter;
            readonly param?: FilterParam;
          };
          readonly stream?: FfmpegPcmStream;
          readonly loudnessProfile?: {
            readonly measuredI: number;
            readonly measuredLra: number;
            readonly measuredThresh: number;
            readonly measuredTp: number;
          };
        } = {
          ...(seekSeconds === undefined ? {} : { seekSeconds }),
          audioFilter: { name: this.#filter, param: this.#filterParam },
          ...(this.#loudnessProfiler === undefined
            ? {}
            : (() => {
                const profile = this.#loudnessProfiler.cached(track.source);
                return profile === undefined
                  ? {}
                  : { loudnessProfile: profile };
              })()),
        };
        let session: FfmpegPlaybackSession;
        try {
          if (seekSeconds === undefined) {
            const warm = this.#takeWarmStream(track.source);
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
          continue;
        }
        session.player.setVolume(volumeToGain(this.#volumePercent));
        this.#session = session;
        this.#driverState = "playing";
        this.#tracksPlayed++;
        this.#recordHistory(track);
        this.#safeObserver(() => this.#onPlaybackStarted(track));
        this.#prefetchWhenStable();
        let playbackError: unknown;
        try {
          await session.done;
        } catch (error) {
          playbackError = error;
        }
        this.#safeObserver(() => {
          this.#onPlaybackFinished(
            track,
            session.player.metrics,
            this.#sessionEndReasons.get(session) ??
              (playbackError !== undefined ? "error" : "completed"),
          );
        });
        if (playbackError !== undefined) {
          this.#reportPlaybackError(track, playbackError);
          const is403 =
            playbackError instanceof Error &&
            /403|Forbidden/i.test(playbackError.message);
          if (is403) {
            const retries = this.#retries.get(track) ?? 0;
            if (retries < MAX_AUDIO_URL_403_RETRIES) {
              this.#retries.set(track, retries + 1);
              // Invalidate stale URL (daemon may have cached a 403'd host).
              // Awaited on purpose: the requeued track's re-resolve can reach
              // the daemon before a fire-and-forget invalidate lands, and the
              // daemon would serve the same dead URL again — burning ~10-25s
              // of dead air and a retry on a URL already known bad.
              this.#preparedStore.drop(track.source);
              await this.#resolver
                .invalidateAudioUrl?.(track.source)
                .catch(() => undefined);
              if (
                this.#epochs.isGenerationCurrent(generation) &&
                this.#current === track
              ) {
                try {
                  this.#queue.requeue(track);
                  this.#queue.moveToHead(track.id);
                  this.#session = undefined;
                  this.#current = undefined;
                  this.#onStateChanged();
                  continue;
                } catch {
                  // Already queued or limit reached: fall through
                }
              }
            }
          }
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
        if (existing.expiresAt > Date.now() + AUDIO_URL_REFRESH_AHEAD_MS) {
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
            stillPrepared.expiresAt <= Date.now() + AUDIO_URL_REFRESH_AHEAD_MS
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
        this.#loudnessProfiler?.measure(next.source, url);
        if (
          this.#current === undefined ||
          this.#queue.snapshot()[0]?.source !== next.source
        ) {
          return undefined;
        }
        // Option parity with the cold path (#playNext's playbackOptions
        // + main.ts wiring): without loudness here, warm-started tracks would
        // sound different from cold-started ones.
        const loudnessProfile = this.#loudnessProfiler?.cached(next.source);
        const stream = this.#createPcmStream(url, {
          audioFilter: { name: this.#filter, param: this.#filterParam },
          ...(this.#proxyUrl === undefined ? {} : { proxyUrl: this.#proxyUrl }),
          ...(this.#loudnessProfiler === undefined
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
