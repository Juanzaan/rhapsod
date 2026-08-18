import { parseMediaInput } from "../media/media-input.js";
import type { YoutubeTrackMetadata } from "../media/youtube/yt-dlp.js";
import type { YoutubeResource } from "../media/media-input.js";
import type { Track } from "../domain/track.js";
import { PlaybackQueue } from "../domain/playback-queue.js";
import {
  playFfmpegUrl,
  type FfmpegPlaybackSession,
} from "../audio/ffmpeg-player.js";
import type { RhapsodOpusEncoder } from "../audio/opus-encoder.js";
import type { VoiceFrameOutput } from "../audio/audio-player.js";
import type { AudioPlayerMetrics } from "../audio/audio-player.js";

export interface PlaybackServiceOptions {
  readonly encoder: RhapsodOpusEncoder;
  readonly resolver: YoutubePlaybackResolver;
  readonly output: VoiceFrameOutput;
  readonly createPlayback?: typeof playFfmpegUrl;
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
}

export type PlaybackEndReason = "completed" | "error" | "skipped" | "stopped";

export interface PlaybackTiming {
  readonly cacheHit?: boolean;
  readonly durationMs: number;
  readonly stage: "metadata" | "audio-url";
  readonly trackId: string;
}

export interface YoutubePlaybackResolver {
  getAudioUrl(resource: YoutubeResource): Promise<string>;
  getAudioUrlFromUrl(url: string): Promise<string>;
  getTrack(resource: YoutubeResource): Promise<YoutubeTrackMetadata>;
  getTrackFromUrl(url: string): Promise<YoutubeTrackMetadata>;
  search(query: string): Promise<YoutubeTrackMetadata>;
}

const AUDIO_URL_FALLBACK_TTL_MS = 10 * 60_000;
const AUDIO_URL_EXPIRY_MARGIN_MS = 60_000;

interface PreparedAudio {
  readonly url: string;
  readonly expiresAt: number;
}

export class YoutubePlaybackService {
  readonly #queue = new PlaybackQueue();
  readonly #encoder: RhapsodOpusEncoder;
  readonly #resolver: YoutubePlaybackResolver;
  readonly #output: VoiceFrameOutput;
  readonly #createPlayback: typeof playFfmpegUrl;
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
  #current: Track | undefined;
  #session: FfmpegPlaybackSession | undefined;
  #generation = 0;
  readonly #prepared = new Map<string, Promise<PreparedAudio>>();
  readonly #sessionEndReasons = new WeakMap<
    FfmpegPlaybackSession,
    PlaybackEndReason
  >();

  constructor(options: PlaybackServiceOptions) {
    this.#encoder = options.encoder;
    this.#resolver = options.resolver;
    this.#output = options.output;
    this.#createPlayback = options.createPlayback ?? playFfmpegUrl;
    this.#onPlaybackError = options.onPlaybackError ?? (() => undefined);
    this.#onPlaybackStarted = options.onPlaybackStarted ?? (() => undefined);
    this.#onPlaybackFinished = options.onPlaybackFinished ?? (() => undefined);
    this.#onTiming = options.onTiming ?? (() => undefined);
  }

  get current(): Track | undefined {
    return this.#current;
  }

  queue(): readonly Track[] {
    return this.#queue.snapshot();
  }

  async enqueue(input: string, requestedBy: string): Promise<Track> {
    const startedAt = Date.now();
    const media = parseMediaInput(input);
    if (media.kind === "soundcloud") {
      const metadata = await this.#resolver.getTrackFromUrl(media.value);
      this.#recordMetadataTiming(metadata, startedAt);
      return this.#enqueueMetadata(metadata, requestedBy);
    }
    if (media.kind !== "youtube" || media.resource.type !== "video") {
      throw new Error(
        "Only YouTube video and SoundCloud track links are supported for playback yet",
      );
    }
    const metadata = await this.#resolver.getTrack(media.resource);
    this.#recordMetadataTiming(metadata, startedAt);
    return this.#enqueueMetadata(metadata, requestedBy);
  }

  async enqueueSearch(query: string, requestedBy: string): Promise<Track> {
    const startedAt = Date.now();
    const metadata = await this.#resolver.search(query);
    this.#recordMetadataTiming(metadata, startedAt);
    return this.#enqueueMetadata(metadata, requestedBy);
  }

  #enqueueMetadata(metadata: YoutubeTrackMetadata, requestedBy: string): Track {
    const track: Track = {
      id: metadata.id,
      requestedBy,
      source: metadata.webpageUrl,
      title: metadata.title,
    };
    if (metadata.audioUrl) this.#cacheAudioUrl(track, metadata.audioUrl);
    this.#queue.add(track);
    if (!this.#current) void this.#playNext();
    else this.#prefetchNext();
    return track;
  }

  skip(): void {
    this.#generation++;
    if (this.#current) this.#prepared.delete(this.#current.source);
    if (this.#session) this.#sessionEndReasons.set(this.#session, "skipped");
    this.#session?.stop();
    this.#session = undefined;
    this.#current = undefined;
    void this.#playNext();
  }

  stop(): void {
    this.#generation++;
    if (this.#session) this.#sessionEndReasons.set(this.#session, "stopped");
    this.#session?.stop();
    this.#session = undefined;
    this.#current = undefined;
    this.#queue.clear();
    this.#prepared.clear();
  }

  pause(): void {
    this.#session?.player.pause();
  }

  resume(): void {
    this.#session?.player.resume();
  }

  removeQueued(position: number): Track | undefined {
    const track = this.#queue.snapshot()[position - 1];
    const removed = track ? this.#queue.remove(track.id) : undefined;
    if (removed) this.#prepared.delete(removed.source);
    return removed;
  }

  clearQueued(): number {
    const count = this.#queue.length;
    this.#queue.clear();
    this.#prepared.clear();
    return count;
  }

  #playNext(): Promise<void> {
    const track = this.#queue.next();
    if (!track) {
      this.#current = undefined;
      return Promise.resolve();
    }
    const generation = ++this.#generation;
    this.#current = track;
    const audioResolutionStartedAt = Date.now();
    return this.#getAudioUrl(track)
      .then(({ cacheHit, url }) => {
        this.#onTiming({
          cacheHit,
          durationMs: Date.now() - audioResolutionStartedAt,
          stage: "audio-url",
          trackId: track.id,
        });
        if (generation !== this.#generation || this.#current !== track) return;
        const session = this.#createPlayback(url, this.#encoder, this.#output);
        this.#session = session;
        void this.#onPlaybackStarted(track);
        this.#prefetchNext();
        return session.done.then(
          () => {
            this.#onPlaybackFinished(
              track,
              session.player.metrics,
              this.#sessionEndReasons.get(session) ?? "completed",
            );
          },
          (error: unknown) => {
            this.#onPlaybackFinished(track, session.player.metrics, "error");
            throw error;
          },
        );
      })
      .catch(async (error: unknown) => {
        const playbackError =
          error instanceof Error ? error : new Error(String(error));
        await this.#onPlaybackError(track, playbackError);
      })
      .then(() => {
        if (generation !== this.#generation || this.#current !== track) return;
        this.#prepared.delete(track.source);
        this.#session = undefined;
        this.#current = undefined;
        return this.#playNext();
      });
  }

  #cacheAudioUrl(track: Track, url: string): void {
    this.#prepared.set(
      track.source,
      Promise.resolve({ url, expiresAt: audioUrlExpiresAt(url) }),
    );
  }

  #getAudioUrl(track: Track): Promise<{ cacheHit: boolean; url: string }> {
    const cached = this.#prepared.get(track.source);
    if (cached) {
      return cached.then((prepared) => {
        if (prepared.expiresAt > Date.now()) {
          return { cacheHit: true, url: prepared.url };
        }
        this.#prepared.delete(track.source);
        return this.#resolveAudioUrl(track).then((url) => ({
          cacheHit: false,
          url,
        }));
      });
    }
    return this.#resolveAudioUrl(track).then((url) => ({
      cacheHit: false,
      url,
    }));
  }

  #resolveAudioUrl(track: Track): Promise<string> {
    const pending = this.#resolver
      .getAudioUrlFromUrl(track.source)
      .then((url) => ({
        url,
        expiresAt: audioUrlExpiresAt(url),
      }));
    this.#prepared.set(track.source, pending);
    return pending.then((prepared) => prepared.url);
  }

  #prefetchNext(): void {
    const next = this.#queue.snapshot()[0];
    if (!next || this.#prepared.has(next.source)) return;
    void this.#resolveAudioUrl(next).catch(() => {
      this.#prepared.delete(next.source);
    });
  }

  #recordMetadataTiming(
    metadata: YoutubeTrackMetadata,
    startedAt: number,
  ): void {
    this.#onTiming({
      durationMs: Date.now() - startedAt,
      stage: "metadata",
      trackId: metadata.id,
    });
  }
}

function audioUrlExpiresAt(url: string): number {
  try {
    const expiresSeconds = Number(new URL(url).searchParams.get("expire"));
    if (Number.isFinite(expiresSeconds) && expiresSeconds > 0) {
      return expiresSeconds * 1_000 - AUDIO_URL_EXPIRY_MARGIN_MS;
    }
  } catch {
    // The resolver already validates URLs; use a conservative TTL if parsing fails.
  }
  return Date.now() + AUDIO_URL_FALLBACK_TTL_MS;
}
