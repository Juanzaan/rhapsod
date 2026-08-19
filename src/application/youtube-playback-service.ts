import { parseMediaInput } from "../media/media-input.js";
import type {
  PlaylistExpansion,
  YoutubeTrackMetadata,
} from "../media/youtube/yt-dlp.js";
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
import type { AlternativeSourceResolver } from "../media/song-link.js";
import {
  SoundCloudDrmError,
  type SoundCloudDrmMetadata,
  type SoundCloudResolver,
} from "../media/soundcloud/public-api.js";
import type { SpotifyResource } from "../media/media-input.js";
import type { SpotifyResolver } from "../media/spotify/api.js";

export type LoopMode = "off" | "queue" | "track";

export function volumeToGain(percent: number): number {
  return 10 ** ((percent - 100) * 0.02);
}

interface PlaybackServiceOptions {
  readonly encoder: RhapsodOpusEncoder;
  readonly resolver: YoutubePlaybackResolver;
  readonly alternativeResolver?: AlternativeSourceResolver;
  readonly soundcloudResolver?: SoundCloudResolver;
  readonly spotifyResolver?: SpotifyResolver;
  readonly output: VoiceFrameOutput;
  readonly playlistMaxTracks?: number;
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

type PlaybackEndReason = "completed" | "error" | "skipped" | "stopped";

interface PlaybackTiming {
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
  search(
    query: string,
    expectedDurationSeconds?: number,
  ): Promise<YoutubeTrackMetadata>;
  expandPlaylist(
    resource: YoutubeResource,
    limit: number,
  ): Promise<PlaylistExpansion>;
}

interface PlaylistEnqueueResult {
  readonly added: readonly Track[];
  readonly remaining?: number;
}

const AUDIO_URL_FALLBACK_TTL_MS = 10 * 60_000;
const AUDIO_URL_EXPIRY_MARGIN_MS = 60_000;
const DEFAULT_PLAYLIST_MAX_TRACKS = 20;

interface PreparedAudio {
  readonly url: string;
  readonly expiresAt: number;
}

export class YoutubePlaybackService {
  readonly #queue = new PlaybackQueue();
  readonly #encoder: RhapsodOpusEncoder;
  readonly #resolver: YoutubePlaybackResolver;
  readonly #alternativeResolver: AlternativeSourceResolver | undefined;
  readonly #soundcloudResolver: SoundCloudResolver | undefined;
  readonly #spotifyResolver: SpotifyResolver | undefined;
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
  readonly #playlistMaxTracks: number;
  #current: Track | undefined;
  #session: FfmpegPlaybackSession | undefined;
  #generation = 0;
  #volumePercent = 100;
  #loopMode: LoopMode = "off";
  #loopPool: Track[] = [];
  readonly #prepared = new Map<string, Promise<PreparedAudio>>();
  readonly #sessionEndReasons = new WeakMap<
    FfmpegPlaybackSession,
    PlaybackEndReason
  >();

  constructor(options: PlaybackServiceOptions) {
    this.#encoder = options.encoder;
    this.#resolver = options.resolver;
    this.#alternativeResolver = options.alternativeResolver;
    this.#soundcloudResolver = options.soundcloudResolver;
    this.#spotifyResolver = options.spotifyResolver;
    this.#output = options.output;
    this.#createPlayback = options.createPlayback ?? playFfmpegUrl;
    this.#onPlaybackError = options.onPlaybackError ?? (() => undefined);
    this.#onPlaybackStarted = options.onPlaybackStarted ?? (() => undefined);
    this.#onPlaybackFinished = options.onPlaybackFinished ?? (() => undefined);
    this.#onTiming = options.onTiming ?? (() => undefined);
    this.#playlistMaxTracks =
      options.playlistMaxTracks ?? DEFAULT_PLAYLIST_MAX_TRACKS;
  }

  get current(): Track | undefined {
    return this.#current;
  }

  queue(): readonly Track[] {
    return this.#queue.snapshot();
  }

  get volume(): number {
    return this.#volumePercent;
  }

  setVolume(percent: number): void {
    this.#volumePercent = Math.max(0, Math.min(100, Math.round(percent)));
    this.#session?.player.setVolume(volumeToGain(this.#volumePercent));
  }

  get loopMode(): LoopMode {
    return this.#loopMode;
  }

  setLoopMode(mode: LoopMode): void {
    this.#loopMode = mode;
    this.#loopPool = mode === "queue" ? [...this.#queue.snapshot()] : [];
  }

  async enqueue(input: string, requestedBy: string): Promise<Track> {
    const startedAt = Date.now();
    const media = parseMediaInput(input);
    if (media.kind === "file") {
      if (input.trim().startsWith("file:")) {
        throw new Error(
          "Los archivos locales no están soportados: pegá un link de YouTube o SoundCloud, o buscá con !yt.",
        );
      }
      return this.enqueueSearch(media.value, requestedBy);
    }
    if (media.kind === "spotify") {
      if (!this.#spotifyResolver) {
        throw new Error(
          "Spotify no está configurado en este bot: pegá un link de YouTube o SoundCloud, o buscá con !yt.",
        );
      }
      if (media.resource.type !== "track") {
        throw new Error(
          "Las playlists y álbumes de Spotify se expanden con !play desde el canal.",
        );
      }
      const spotifyTrack = await this.#spotifyResolver.getTrack(media.resource);
      const query = `${spotifyTrack.artist} ${spotifyTrack.title}`.trim();
      if (!query) {
        throw new Error("No encontré los datos del track de Spotify.");
      }
      const metadata = await this.#resolver.search(
        query,
        spotifyTrack.durationSeconds,
      );
      this.#recordMetadataTiming(metadata, startedAt);
      return this.#enqueueMetadata(metadata, requestedBy, "spotify");
    }
    if (media.kind === "url") {
      throw new Error(
        "No reconozco ese link: pegá un link de YouTube o SoundCloud, o buscá con !yt.",
      );
    }
    if (media.kind === "soundcloud") {
      try {
        const metadata = this.#soundcloudResolver
          ? await this.#soundcloudResolver.getTrack(media.value)
          : await this.#resolver.getTrackFromUrl(media.value);
        this.#recordMetadataTiming(metadata, startedAt);
        return this.#enqueueMetadata(metadata, requestedBy);
      } catch (error) {
        let providerError = error;
        if (this.#soundcloudResolver && !isDrmError(providerError)) {
          try {
            const metadata = await this.#resolver.getTrackFromUrl(media.value);
            this.#recordMetadataTiming(metadata, startedAt);
            return this.#enqueueMetadata(metadata, requestedBy);
          } catch (fallbackError) {
            providerError = fallbackError;
          }
        }
        if (!isDrmError(providerError)) throw providerError;
        if (this.#alternativeResolver) {
          const alternative = await this.#alternativeResolver.findAlternative(
            media.value,
          );
          if (alternative) {
            const metadata = await this.#resolver.getTrackFromUrl(
              alternative.url,
            );
            this.#recordMetadataTiming(metadata, startedAt);
            return this.#enqueueMetadata(
              metadata,
              requestedBy,
              alternative.provider,
            );
          }
        }
        if (providerError instanceof SoundCloudDrmError) {
          const fallback = await this.#searchByMetadata(
            providerError.metadata,
            startedAt,
          );
          if (fallback)
            return this.#enqueueMetadata(fallback, requestedBy, "youtube");
        }
        throw providerError;
      }
    }
    if (media.kind !== "youtube" || media.resource.type !== "video") {
      throw new Error(
        "Solo se soportan videos de YouTube, links de SoundCloud y playlists de YouTube por ahora.",
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

  async enqueuePlaylist(
    resource: YoutubeResource,
    requestedBy: string,
  ): Promise<PlaylistEnqueueResult> {
    if (resource.type !== "playlist")
      throw new Error("Only YouTube playlists can be expanded");
    const expansion = await this.#resolver.expandPlaylist(
      resource,
      this.#playlistMaxTracks,
    );
    const added: Track[] = [];
    let duplicates = 0;
    const addedIds = new Set<string>();
    for (const metadata of expansion.tracks.slice(0, this.#playlistMaxTracks)) {
      if (addedIds.has(metadata.id) || this.#current?.id === metadata.id) {
        duplicates++;
        continue;
      }
      try {
        const track = this.#enqueueMetadata(metadata, requestedBy);
        addedIds.add(track.id);
        added.push(track);
      } catch (error) {
        if (error instanceof Error && /already queued/i.test(error.message)) {
          duplicates++;
          continue;
        }
        throw error;
      }
    }
    return {
      added,
      ...(expansion.total === undefined
        ? {}
        : {
            remaining: Math.max(0, expansion.total - added.length - duplicates),
          }),
    };
  }

  async enqueueSpotifyCollection(
    resource: SpotifyResource,
    requestedBy: string,
  ): Promise<PlaylistEnqueueResult> {
    if (!this.#spotifyResolver) {
      throw new Error(
        "Spotify no está configurado en este bot: pegá un link de YouTube o SoundCloud, o buscá con !yt.",
      );
    }
    if (resource.type !== "playlist" && resource.type !== "album") {
      throw new Error("Only Spotify collections can be expanded");
    }
    const expansion =
      resource.type === "playlist"
        ? await this.#spotifyResolver.expandPlaylist(
            resource,
            this.#playlistMaxTracks,
          )
        : await this.#spotifyResolver.expandAlbum(
            resource,
            this.#playlistMaxTracks,
          );
    const added: Track[] = [];
    let duplicates = 0;
    const addedIds = new Set<string>();
    for (const spotifyTrack of expansion.tracks.slice(
      0,
      this.#playlistMaxTracks,
    )) {
      const query = `${spotifyTrack.artist} ${spotifyTrack.title}`.trim();
      if (!query) {
        duplicates++;
        continue;
      }
      const startedAt = Date.now();
      let metadata: YoutubeTrackMetadata;
      try {
        metadata = await this.#resolver.search(
          query,
          spotifyTrack.durationSeconds,
        );
      } catch {
        duplicates++;
        continue;
      }
      this.#recordMetadataTiming(metadata, startedAt);
      if (addedIds.has(metadata.id) || this.#current?.id === metadata.id) {
        duplicates++;
        continue;
      }
      try {
        const track = this.#enqueueMetadata(metadata, requestedBy, "spotify");
        addedIds.add(track.id);
        added.push(track);
      } catch (error) {
        if (error instanceof Error && /already queued/i.test(error.message)) {
          duplicates++;
          continue;
        }
        throw error;
      }
    }
    return {
      added,
      ...(expansion.total === undefined
        ? {}
        : {
            remaining: Math.max(0, expansion.total - added.length - duplicates),
          }),
    };
  }

  #enqueueMetadata(
    metadata: YoutubeTrackMetadata,
    requestedBy: string,
    alternativeProvider?: string,
  ): Track {
    const track: Track = {
      id: metadata.id,
      requestedBy,
      source: metadata.webpageUrl,
      title: metadata.title,
      ...(metadata.durationSeconds === undefined
        ? {}
        : { durationSeconds: metadata.durationSeconds }),
      ...(alternativeProvider ? { alternativeProvider } : {}),
      ...(metadata.fallbackSources
        ? { fallbackSources: metadata.fallbackSources }
        : {}),
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
    this.#loopMode = "off";
    this.#loopPool = [];
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
    this.#loopMode = "off";
    this.#loopPool = [];
    this.#prepared.clear();
    return count;
  }

  shuffleQueued(): number {
    const count = this.#queue.length;
    this.#queue.shuffle();
    return count;
  }

  #playNext(): Promise<void> {
    if (this.#queue.length === 0 && this.#loopPool.length > 0) {
      for (const pooled of this.#loopPool) {
        try {
          this.#queue.add(pooled);
        } catch {
          // already queued; skip
        }
      }
      this.#loopPool = [];
    }
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
        session.player.setVolume(volumeToGain(this.#volumePercent));
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
        if (this.#loopMode === "track") {
          try {
            this.#queue.add(track);
          } catch {
            // already queued; skip
          }
        } else if (this.#loopMode === "queue") {
          this.#loopPool.push(track);
        }
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
    const pending = this.#resolvePlayableAudio(track).then((url) => ({
      url,
      expiresAt: audioUrlExpiresAt(url),
    }));
    this.#prepared.set(track.source, pending);
    return pending.then((prepared) => prepared.url);
  }

  async #resolvePlayableAudio(track: Track): Promise<string> {
    if (this.#soundcloudResolver?.match(track.source)) {
      return this.#soundcloudResolver.getAudioUrl(track.source);
    }
    let lastError: unknown;
    for (const source of [track.source, ...(track.fallbackSources ?? [])]) {
      try {
        return await this.#resolver.getAudioUrlFromUrl(source);
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError instanceof Error) throw lastError;
    throw new Error("No playable audio source");
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

  async #searchByMetadata(
    metadata: SoundCloudDrmMetadata,
    startedAt: number,
  ): Promise<YoutubeTrackMetadata | undefined> {
    const query = `${metadata.artist} ${metadata.title}`.trim();
    if (!query) return undefined;
    try {
      const candidate = await this.#resolver.search(
        query,
        metadata.durationSeconds,
      );
      this.#recordMetadataTiming(candidate, startedAt);
      return candidate;
    } catch {
      return undefined;
    }
  }
}

function isDrmError(error: unknown): boolean {
  return error instanceof Error && /DRM protected/i.test(error.message);
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
