import { parseMediaInput } from "../media/media-input.js";
import type { RedirectResolver } from "../media/redirect-resolver.js";
import type {
  PlaylistExpansion,
  YoutubeTrackMetadata,
} from "../media/youtube/yt-dlp.js";
import type { YoutubeResource } from "../media/media-input.js";
import type { Track } from "../domain/track.js";
import { PlaybackQueue } from "../domain/playback-queue.js";
import {
  createPcmStream,
  playFfmpegUrl,
  type FfmpegPlaybackSession,
} from "../audio/ffmpeg-player.js";
import type { LoudnessProfiler } from "../audio/loudness-profiler.js";
import type { FfmpegPcmStream } from "../audio/ffmpeg-pcm.js";
import type { RhapsodOpusEncoder } from "../audio/opus-encoder.js";
import { FRAME_DURATION_MS } from "../audio/opus-encoder.js";
import type { VoiceFrameOutput } from "../audio/audio-player.js";
import {
  isAudioFilter,
  type AudioFilter,
  type FilterParam,
} from "../audio/filter-chain.js";
import type { AudioPlayerMetrics } from "../audio/audio-player.js";
import type { AlternativeSourceResolver } from "../media/song-link.js";
import type { DirectUrlResolver } from "../media/direct-url.js";
import {
  SoundCloudDrmError,
  type SoundCloudDrmMetadata,
  type SoundCloudResolver,
} from "../media/soundcloud/public-api.js";
import type { SpotifyResource } from "../media/media-input.js";
import type { SpotifyResolver } from "../media/spotify/api.js";
import type { PlaybackStateStore } from "../domain/state-store.js";
import type { SerializedQueueTrack } from "../domain/state-store.js";
import type { AudioUrlCache } from "./audio-url-cache.js";
import {
  parseArtistTitle,
  type LyricsResolver,
  type TrackLyrics,
} from "../media/lyrics.js";
import type {
  AudioUrlSource,
  PrefetchStatus,
} from "../observability/metrics.js";
import { parseMusicQuery } from "../lib/query-parser.js";
import { UserError } from "../lib/user-error.js";
import {
  MAX_TRACKS_PER_PLAYLIST,
  type PlaylistAddResult,
  type PlaylistInfo,
  type PlaylistRemoveResult,
  type PlaylistRenameResult,
  type PlaylistStore,
  type PlaylistSummary,
  type SavedPlaylist,
  type StoredPlaylistTrack,
} from "./playlist-store.js";

export type LoopMode = "off" | "queue" | "track";

export function volumeToGain(percent: number): number {
  return 10 ** ((percent - 100) * 0.02);
}

interface PlaybackServiceOptions {
  readonly encoder: RhapsodOpusEncoder;
  readonly resolver: YoutubePlaybackResolver;
  readonly alternativeResolver?: AlternativeSourceResolver;
  readonly directUrlResolver?: DirectUrlResolver;
  readonly soundcloudResolver?: SoundCloudResolver;
  readonly spotifyResolver?: SpotifyResolver;
  readonly lyricsResolver?: LyricsResolver;
  readonly stateStore?: PlaybackStateStore;
  readonly audioUrlCache?: AudioUrlCache;
  readonly redirectResolver?: RedirectResolver;
  readonly playlistStore?: PlaylistStore;
  readonly output: VoiceFrameOutput;
  readonly playlistMaxTracks?: number;
  readonly maxQueueTracks?: number;
  readonly maxTracksPerUser?: number;
  readonly createPlayback?: typeof playFfmpegUrl;
  readonly createPcmStream?: typeof createPcmStream;
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
}

type PlaybackEndReason =
  "completed" | "error" | "skipped" | "stopped" | "filter-change";

interface PlaybackTiming {
  readonly audioUrlSource?: AudioUrlSource;
  readonly cacheHit?: boolean;
  readonly durationMs: number;
  readonly prefetchStatus?: PrefetchStatus;
  readonly stage: "metadata" | "audio-url";
  readonly trackId: string;
}

export interface YoutubePlaybackResolver {
  getAudioUrlFromUrl(url: string, signal?: AbortSignal): Promise<string>;
  getTrack(resource: YoutubeResource): Promise<YoutubeTrackMetadata>;
  getTrackFromUrl(url: string): Promise<YoutubeTrackMetadata>;
  search(
    query: string,
    expectedDurationSeconds?: number,
    expectedTitle?: string,
  ): Promise<YoutubeTrackMetadata>;
  searchMany(
    query: string,
    expectedDurationSeconds?: number,
    limit?: number,
    expectedTitle?: string,
  ): Promise<readonly YoutubeTrackMetadata[]>;
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
const AUDIO_URL_REFRESH_AHEAD_MS = 3 * 60_000;
const AUTH_REQUIRED_RE =
  /sign in to confirm|cookies for the authentication|request you to sign in|login required/i;
const PREFETCH_STABILITY_TIMEOUT_MS = 8_000;
const PREFETCH_STABILITY_POLL_MS = 100;
const PREFETCH_DEPTH = 4;
const PLAYLIST_PREFETCH_DEPTH = 6;
const PLAYLIST_PREFETCH_BATCH = 3;
const DEFAULT_PLAYLIST_MAX_TRACKS = 100;
const DEFAULT_MAX_QUEUE_TRACKS = 200;
const DEFAULT_MAX_TRACKS_PER_USER = 30;
const HISTORY_LIMIT = 20;

class QueueLimitError extends UserError {}

interface PreparedAudio {
  readonly url: string;
  readonly expiresAt: number;
}

interface PreparedAudioEntry {
  readonly abort?: AbortController;
  readonly promise: Promise<PreparedAudio>;
  expiresAt: number;
  readonly origin: AudioUrlSource;
  status: "pending" | "ready";
}

export class YoutubePlaybackService {
  readonly #queue = new PlaybackQueue();
  readonly #encoder: RhapsodOpusEncoder;
  readonly #resolver: YoutubePlaybackResolver;
  readonly #alternativeResolver: AlternativeSourceResolver | undefined;
  readonly #directUrlResolver: DirectUrlResolver | undefined;
  readonly #soundcloudResolver: SoundCloudResolver | undefined;
  readonly #spotifyResolver: SpotifyResolver | undefined;
  readonly #lyricsResolver: LyricsResolver | undefined;
  readonly #stateStore: PlaybackStateStore | undefined;
  #persistedQueue: readonly SerializedQueueTrack[] = [];
  readonly #output: VoiceFrameOutput;
  readonly #createPlayback: typeof playFfmpegUrl;
  readonly #createPcmStream: typeof createPcmStream;
  readonly #prewarmEnabled: boolean;
  readonly #loudnessProfiler: LoudnessProfiler | undefined;
  #warmStream:
    { readonly source: string; readonly stream: FfmpegPcmStream } | undefined;
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
  readonly #audioUrlCache: AudioUrlCache | undefined;
  readonly #redirectResolver: RedirectResolver | undefined;
  readonly #playlistStore: PlaylistStore | undefined;
  readonly #playlistMaxTracks: number;
  readonly #maxQueueTracks: number;
  readonly #maxTracksPerUser: number;
  #expansionActive = false;
  #stopEpoch = 0;
  #current: Track | undefined;
  #session: FfmpegPlaybackSession | undefined;
  #generation = 0;
  #chainActive = false;
  #pendingSeek:
    { readonly seconds: number; readonly trackId: string } | undefined;
  #pendingSkips = 0;
  #volumePercent = 50;
  #tracksPlayed = 0;
  readonly #history: Track[] = [];
  #loopMode: LoopMode = "off";
  #loopPool: Track[] = [];
  #persistenceSuppressed = false;
  readonly #prepared = new Map<string, PreparedAudioEntry>();
  readonly #sessionEndReasons = new WeakMap<
    FfmpegPlaybackSession,
    PlaybackEndReason
  >();
  #filter: AudioFilter = "off";
  #filterParam: FilterParam = {};

  constructor(options: PlaybackServiceOptions) {
    this.#encoder = options.encoder;
    this.#resolver = options.resolver;
    this.#alternativeResolver = options.alternativeResolver;
    this.#directUrlResolver = options.directUrlResolver;
    this.#soundcloudResolver = options.soundcloudResolver;
    this.#spotifyResolver = options.spotifyResolver;
    this.#lyricsResolver = options.lyricsResolver;
    this.#stateStore = options.stateStore;
    this.#output = options.output;
    this.#createPlayback = options.createPlayback ?? playFfmpegUrl;
    this.#createPcmStream = options.createPcmStream ?? createPcmStream;
    this.#prewarmEnabled = options.prewarmNext ?? false;
    this.#loudnessProfiler = options.loudnessProfiler;
    this.#onPlaybackError = options.onPlaybackError ?? (() => undefined);
    this.#onPlaybackStarted = options.onPlaybackStarted ?? (() => undefined);
    this.#onPlaybackFinished = options.onPlaybackFinished ?? (() => undefined);
    this.#onTiming = options.onTiming ?? (() => undefined);
    this.#audioUrlCache = options.audioUrlCache;
    this.#redirectResolver = options.redirectResolver;
    this.#playlistStore = options.playlistStore;
    for (const [source, entry] of this.#audioUrlCache?.entries() ?? []) {
      this.#prepared.set(source, {
        expiresAt: entry.expiresAt,
        origin: "cache-load",
        promise: Promise.resolve(entry),
        status: "ready",
      });
    }
    this.#playlistMaxTracks =
      options.playlistMaxTracks ?? DEFAULT_PLAYLIST_MAX_TRACKS;
    this.#maxQueueTracks = options.maxQueueTracks ?? DEFAULT_MAX_QUEUE_TRACKS;
    this.#maxTracksPerUser =
      options.maxTracksPerUser ?? DEFAULT_MAX_TRACKS_PER_USER;
    const restored = this.#stateStore?.load();
    if (restored?.volumePercent !== undefined) {
      this.#volumePercent = restored.volumePercent;
    }
    if (restored?.loopMode !== undefined) {
      this.#loopMode = restored.loopMode;
    }
    if (restored?.filter !== undefined && isAudioFilter(restored.filter)) {
      this.#filter = restored.filter;
    }
    this.#persistedQueue = restored?.queue ?? [];
  }

  get current(): Track | undefined {
    return this.#current;
  }

  queue(): readonly Track[] {
    return this.#queue.snapshot();
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
    this.#persistState();
  }

  get loopMode(): LoopMode {
    return this.#loopMode;
  }

  get filter(): AudioFilter {
    return this.#filter;
  }

  get audioHealth(): AudioPlayerMetrics | undefined {
    return this.#session?.player.metrics;
  }

  setLoopMode(mode: LoopMode): void {
    this.#loopMode = mode;
    this.#loopPool = mode === "queue" ? [...this.#queue.snapshot()] : [];
    this.#persistState();
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
    this.#persistState();
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
    this.#generation++;
    if (this.#session) {
      this.#sessionEndReasons.set(this.#session, "filter-change");
      this.#session.stop();
      this.#session = undefined;
    }
    try {
      this.#queue.add(track);
      this.#queue.moveToHead(track.id);
    } catch {
      // Duplicate already queued: the filter change acts like a restart.
    }
    this.#requestNext();
  }

  async enqueue(
    input: string,
    requestedBy: string,
    requestedByUid?: string,
  ): Promise<Track> {
    const startedAt = Date.now();
    const media = parseMediaInput(input);
    if (media.kind === "file") {
      if (input.trim().startsWith("file:")) {
        throw new UserError(
          "Los archivos locales no están soportados: pegá un link de YouTube o SoundCloud, o buscá con !yt.",
        );
      }
      return this.enqueueSearch(media.value, requestedBy, requestedByUid);
    }
    if (media.kind === "spotify") {
      if (!this.#spotifyResolver) {
        throw new UserError(
          "Spotify no está configurado en este bot: pegá un link de YouTube o SoundCloud, o buscá con !yt.",
        );
      }
      if (media.resource.type !== "track") {
        throw new UserError(
          "Las playlists y álbumes de Spotify se expanden con !play desde el canal.",
        );
      }
      const spotifyTrack = await this.#spotifyResolver.getTrack(media.resource);
      const query = `${spotifyTrack.artist} ${spotifyTrack.title}`.trim();
      if (!query) {
        throw new UserError("No encontré los datos del track de Spotify.");
      }
      const metadata = await this.#resolver.search(
        query,
        spotifyTrack.durationSeconds,
        spotifyTrack.title,
      );
      this.#recordMetadataTiming(metadata, startedAt);
      return this.#enqueueMetadata(
        metadata,
        requestedBy,
        "spotify",
        requestedByUid,
      );
    }
    if (media.kind === "url") {
      if (
        this.#directUrlResolver &&
        (await this.#directUrlResolver.match(media.value))
      ) {
        const metadata = await this.#directUrlResolver.getTrack(media.value);
        this.#recordMetadataTiming(metadata, startedAt);
        return this.#enqueueMetadata(
          metadata,
          requestedBy,
          "direct-url",
          requestedByUid,
        );
      }
      const finalUrl = await this.#redirectResolver?.resolve(media.value);
      if (finalUrl !== undefined && finalUrl !== media.value) {
        const reParsed = parseMediaInput(finalUrl);
        if (reParsed.kind !== "url") {
          return this.enqueue(finalUrl, requestedBy, requestedByUid);
        }
      }
      throw new UserError(
        "No reconozco ese link: pegá un link de YouTube o SoundCloud, una URL de audio directa (mp3, ogg, m3u8…), o buscá con !yt.",
      );
    }
    if (media.kind === "soundcloud") {
      if (/\/sets\//i.test(media.value)) {
        const result = await this.enqueueMusicLink(
          media.value,
          requestedBy,
          requestedByUid,
        );
        const first = result.added[0];
        if (!first) {
          throw new UserError(
            "No pude encontrar ese set de SoundCloud en YouTube o SoundCloud.",
          );
        }
        return first;
      }
      try {
        const metadata = this.#soundcloudResolver
          ? await this.#soundcloudResolver.getTrack(media.value)
          : await this.#resolver.getTrackFromUrl(media.value);
        this.#recordMetadataTiming(metadata, startedAt);
        return this.#enqueueMetadata(
          metadata,
          requestedBy,
          undefined,
          requestedByUid,
        );
      } catch (error) {
        let providerError = error;
        if (this.#soundcloudResolver && !isDrmError(providerError)) {
          try {
            const metadata = await this.#resolver.getTrackFromUrl(media.value);
            this.#recordMetadataTiming(metadata, startedAt);
            return this.#enqueueMetadata(
              metadata,
              requestedBy,
              undefined,
              requestedByUid,
            );
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
            if (
              alternative.provider === "soundcloud" &&
              this.#soundcloudResolver
            ) {
              const metadata = await this.#soundcloudResolver.getTrack(
                alternative.url,
              );
              this.#recordMetadataTiming(metadata, startedAt);
              return this.#enqueueMetadata(
                metadata,
                requestedBy,
                undefined,
                requestedByUid,
              );
            }
            const metadata = await this.#resolver.getTrackFromUrl(
              alternative.url,
            );
            this.#recordMetadataTiming(metadata, startedAt);
            return this.#enqueueMetadata(
              metadata,
              requestedBy,
              alternative.provider,
              requestedByUid,
            );
          }
        }
        if (providerError instanceof SoundCloudDrmError) {
          const fallback = await this.#searchByMetadata(
            providerError.metadata,
            startedAt,
          );
          if (fallback)
            return this.#enqueueMetadata(
              fallback,
              requestedBy,
              "youtube",
              requestedByUid,
            );
        }
        throw providerError;
      }
    }
    if (media.kind === "apple-music" || media.kind === "amazon-music") {
      const result = await this.enqueueMusicLink(
        media.value,
        requestedBy,
        requestedByUid,
      );
      const first = result.added[0];
      if (!first) {
        throw new UserError(
          "No pude encontrar esa canción en YouTube o SoundCloud.",
        );
      }
      return first;
    }
    if (media.kind !== "youtube" || media.resource.type !== "video") {
      throw new UserError(
        "Solo se soportan videos de YouTube, links de SoundCloud y playlists de YouTube por ahora.",
      );
    }
    const metadata = await this.#resolver.getTrack(media.resource);
    this.#recordMetadataTiming(metadata, startedAt);
    return this.#enqueueMetadata(
      metadata,
      requestedBy,
      undefined,
      requestedByUid,
    );
  }

  async enqueueSearch(
    query: string,
    requestedBy: string,
    requestedByUid?: string,
  ): Promise<Track> {
    const startedAt = Date.now();
    const parsed = parseMusicQuery(query);
    const metadata = await this.#resolver.search(
      query,
      undefined,
      parsed.artist,
    );
    this.#recordMetadataTiming(metadata, startedAt);
    return this.#enqueueMetadata(
      metadata,
      requestedBy,
      undefined,
      requestedByUid,
    );
  }

  async enqueueSearchIndex(
    query: string,
    index: number,
    requestedBy: string,
    requestedByUid?: string,
  ): Promise<Track> {
    const startedAt = Date.now();
    const parsed = parseMusicQuery(query);
    const candidates = await this.#resolver.searchMany(
      query,
      undefined,
      5,
      parsed.artist,
    );
    const selected = candidates[index - 1];
    if (!selected) {
      throw new UserError(`No hay resultado ${index} para esa búsqueda.`);
    }
    this.#recordMetadataTiming(selected, startedAt);
    return this.#enqueueMetadata(
      selected,
      requestedBy,
      undefined,
      requestedByUid,
    );
  }

  async enqueueNext(
    input: string,
    requestedBy: string,
    requestedByUid?: string,
  ): Promise<Track> {
    const media = parseMediaInput(input);
    if (media.kind === "youtube" && media.resource.type === "playlist") {
      throw new UserError(
        "Las playlists se encolan con !play, no con !playnext.",
      );
    }
    const track = await this.enqueue(input, requestedBy, requestedByUid);
    this.#queue.moveToHead(track.id);
    if (this.#current) this.#prefetchNext();
    this.#persistState();
    return track;
  }

  restoreQueuedTracks(connectedUids: readonly string[]): number {
    const connected = new Set(connectedUids);
    let restored = 0;
    for (const entry of this.#persistedQueue) {
      if (entry.requestedByUid === undefined) continue;
      if (!connected.has(entry.requestedByUid)) continue;
      if (this.#queue.length >= this.#maxQueueTracks) break;
      try {
        this.#queue.add({
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
      this.#prefetchNext();
      this.#requestNext();
    } else if (restored > 0 && this.#isSessionStable()) {
      this.#prefetchNext();
    }
    return restored;
  }

  moveQueued(fromPosition: number, toPosition: number): Track | undefined {
    const moved = this.#queue.move(fromPosition, toPosition);
    if (moved && this.#current) this.#prefetchNext();
    this.#persistState();
    return moved;
  }

  removeQueuedRange(fromPosition: number, toPosition: number): Track[] {
    const removed = this.#queue.removeRange(fromPosition, toPosition);
    for (const track of removed) this.#invalidatePrepared(track.source);
    this.#persistState();
    return removed;
  }

  history(): readonly Track[] {
    return [...this.#history];
  }

  savePlaylist(rawName: string, requestedByUid: string): number {
    const store = this.#requirePlaylistStore();
    const tracks: StoredPlaylistTrack[] = this.#queue
      .snapshot()
      .map((track) => ({
        ...(track.durationSeconds === undefined
          ? {}
          : { durationSeconds: track.durationSeconds }),
        id: track.id,
        source: track.source,
        title: track.title,
      }));
    if (tracks.length === 0) {
      throw new UserError(
        "La cola está vacía: no hay nada para guardar en la playlist.",
      );
    }
    return store.save(requestedByUid, rawName, tracks);
  }

  loadPlaylist(
    rawName: string,
    requestedBy: string,
    requestedByUid: string,
  ): number {
    const store = this.#requirePlaylistStore();
    const playlist = store.load(requestedByUid, rawName);
    if (playlist === undefined) {
      throw new UserError(`No encontré la playlist "${rawName}".`);
    }
    if (playlist.tracks.length === 0) {
      throw new UserError(`La playlist "${rawName}" está vacía.`);
    }
    let added = 0;
    for (const track of playlist.tracks) {
      try {
        this.#enqueueMetadata(
          {
            ...(track.durationSeconds === undefined
              ? {}
              : { durationSeconds: track.durationSeconds }),
            id: track.id,
            title: track.title,
            webpageUrl: track.source,
          },
          requestedBy,
          undefined,
          requestedByUid,
        );
        added++;
      } catch (error) {
        if (error instanceof QueueLimitError) break;
        if (
          error instanceof Error &&
          /ya está en la cola/i.test(error.message)
        ) {
          continue;
        }
        throw error;
      }
    }
    return added;
  }

  listPlaylists(requestedByUid: string): readonly PlaylistSummary[] {
    return this.#requirePlaylistStore().list(requestedByUid);
  }

  showPlaylist(
    rawName: string,
    requestedByUid: string,
  ): SavedPlaylist | undefined {
    return this.#requirePlaylistStore().show(requestedByUid, rawName);
  }

  deletePlaylist(
    rawName: string,
    requestedByUid: string,
    allowAnyUser: boolean,
  ): boolean {
    return this.#requirePlaylistStore().delete(
      requestedByUid,
      rawName,
      allowAnyUser,
    );
  }

  async resolvePlaylistTracks(url: string): Promise<{
    readonly source: "playlist" | "video";
    readonly tracks: readonly StoredPlaylistTrack[];
  }> {
    const media = parseMediaInput(url);
    if (media.kind !== "youtube") {
      throw new UserError(
        "Solo se soportan URLs de YouTube (video o playlist) para agregar.",
      );
    }
    if (media.resource.type === "playlist") {
      const expansion = await this.#resolver.expandPlaylist(
        media.resource,
        MAX_TRACKS_PER_PLAYLIST,
      );
      return {
        source: "playlist",
        tracks: expansion.tracks.map((track) => ({
          ...(track.durationSeconds === undefined
            ? {}
            : { durationSeconds: track.durationSeconds }),
          id: track.id,
          source: `https://www.youtube.com/watch?v=${track.id}`,
          title: track.title,
        })),
      };
    }
    const metadata = await this.#resolver.getTrackFromUrl(url);
    return {
      source: "video",
      tracks: [
        {
          ...(metadata.durationSeconds === undefined
            ? {}
            : { durationSeconds: metadata.durationSeconds }),
          id: metadata.id,
          source: `https://www.youtube.com/watch?v=${metadata.id}`,
          title: metadata.title,
        },
      ],
    };
  }

  addPlaylistTracks(
    rawName: string,
    tracks: readonly StoredPlaylistTrack[],
    requestedByUid: string,
  ): PlaylistAddResult {
    return this.#requirePlaylistStore().addTracksToPlaylist(
      requestedByUid,
      rawName,
      tracks,
    );
  }

  removePlaylistTrack(
    rawName: string,
    trackIndex: number,
    requestedByUid: string,
    allowAnyUser: boolean,
  ): PlaylistRemoveResult {
    return this.#requirePlaylistStore().removeTrackFromPlaylist(
      requestedByUid,
      rawName,
      trackIndex,
      allowAnyUser,
    );
  }

  renamePlaylist(
    oldName: string,
    newName: string,
    requestedByUid: string,
    allowAnyUser: boolean,
  ): PlaylistRenameResult {
    return this.#requirePlaylistStore().renamePlaylist(
      requestedByUid,
      oldName,
      newName,
      allowAnyUser,
    );
  }

  getPlaylistInfo(
    rawName: string,
    requestedByUid: string,
  ): PlaylistInfo | undefined {
    return this.#requirePlaylistStore().getPlaylistInfo(
      requestedByUid,
      rawName,
    );
  }

  #requirePlaylistStore(): PlaylistStore {
    if (this.#playlistStore === undefined) {
      throw new UserError("Las playlists no están configuradas en este bot.");
    }
    return this.#playlistStore;
  }

  async getLyrics(): Promise<TrackLyrics | undefined> {
    if (!this.#lyricsResolver || !this.#current) return undefined;
    const parsed = parseArtistTitle(this.#current.title);
    return this.#lyricsResolver.search(parsed.artist, parsed.title);
  }

  async enqueuePlaylist(
    resource: YoutubeResource,
    requestedBy: string,
    requestedByUid?: string,
  ): Promise<PlaylistEnqueueResult> {
    if (resource.type !== "playlist")
      throw new UserError(
        "Solo se pueden expandir playlists de YouTube con !play.",
      );
    return this.#withExpansionSlot(async () => {
      const stopEpoch = this.#stopEpoch;
      const expansion = await this.#resolver.expandPlaylist(
        resource,
        this.#playlistMaxTracks,
      );
      return this.#enqueuePlaylistExpansion(
        expansion,
        requestedBy,
        requestedByUid,
        stopEpoch,
      );
    });
  }

  async enqueueMusicLink(
    input: string,
    requestedBy: string,
    requestedByUid?: string,
  ): Promise<PlaylistEnqueueResult> {
    return this.#withExpansionSlot(async () => {
      const stopEpoch = this.#stopEpoch;
      if (!this.#alternativeResolver) {
        throw new UserError(
          "Este bot no tiene resolución de links de Apple Music o Amazon Music configurada.",
        );
      }
      const alternative =
        await this.#alternativeResolver.findAlternative(input);
      if (stopEpoch !== this.#stopEpoch) {
        return { added: [] };
      }
      if (!alternative) {
        throw new UserError(
          "No pude encontrar ese link en YouTube o SoundCloud. Probá pegando el link directo de YouTube.",
        );
      }
      if (alternative.provider === "soundcloud") {
        if (!this.#soundcloudResolver) {
          throw new UserError(
            "El link solo existe en SoundCloud, pero ese proveedor no está configurado.",
          );
        }
        const metadata = await this.#soundcloudResolver.getTrack(
          alternative.url,
        );
        this.#recordMetadataTiming(metadata, Date.now());
        return {
          added: [
            this.#enqueueMetadata(
              metadata,
              requestedBy,
              undefined,
              requestedByUid,
            ),
          ],
        };
      }
      const parsed = parseMediaInput(alternative.url);
      if (parsed.kind === "youtube" && parsed.resource.type === "playlist") {
        const expansion = await this.#resolver.expandPlaylist(
          parsed.resource,
          this.#playlistMaxTracks,
        );
        return this.#enqueuePlaylistExpansion(
          expansion,
          requestedBy,
          requestedByUid,
          stopEpoch,
        );
      }
      if (parsed.kind === "youtube" && parsed.resource.type === "video") {
        const metadata = await this.#resolver.getTrack(parsed.resource);
        this.#recordMetadataTiming(metadata, Date.now());
        return {
          added: [
            this.#enqueueMetadata(
              metadata,
              requestedBy,
              undefined,
              requestedByUid,
            ),
          ],
        };
      }
      if (parsed.kind === "soundcloud" && this.#soundcloudResolver) {
        const metadata = await this.#soundcloudResolver.getTrack(parsed.value);
        this.#recordMetadataTiming(metadata, Date.now());
        return {
          added: [
            this.#enqueueMetadata(
              metadata,
              requestedBy,
              undefined,
              requestedByUid,
            ),
          ],
        };
      }
      throw new UserError(
        "El link alternativo no apunta a una fuente reproducible.",
      );
    });
  }

  #enqueuePlaylistExpansion(
    expansion: PlaylistExpansion,
    requestedBy: string,
    requestedByUid?: string,
    stopEpoch = this.#stopEpoch,
  ): PlaylistEnqueueResult {
    const added: Track[] = [];
    let duplicates = 0;
    let halted = false;
    const addedIds = new Set<string>();
    for (const metadata of expansion.tracks.slice(0, this.#playlistMaxTracks)) {
      if (stopEpoch !== this.#stopEpoch) {
        halted = true;
        break;
      }
      if (addedIds.has(metadata.id) || this.#current?.id === metadata.id) {
        duplicates++;
        continue;
      }
      try {
        const track = this.#enqueueMetadata(
          metadata,
          requestedBy,
          undefined,
          requestedByUid,
        );
        addedIds.add(track.id);
        added.push(track);
      } catch (error) {
        if (error instanceof QueueLimitError) {
          halted = true;
          break;
        }
        if (
          error instanceof Error &&
          /ya está en la cola/i.test(error.message)
        ) {
          duplicates++;
          continue;
        }
        throw error;
      }
    }
    return {
      added,
      ...(halted || expansion.total !== undefined
        ? {
            remaining: Math.max(
              0,
              (expansion.total ?? expansion.tracks.length) -
                added.length -
                duplicates,
            ),
          }
        : {}),
    };
  }

  async #withExpansionSlot<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#expansionActive) {
      throw new UserError(
        "Ya hay una playlist o álbum expandiéndose; esperá un momento.",
      );
    }
    this.#expansionActive = true;
    try {
      return await operation();
    } finally {
      this.#expansionActive = false;
    }
  }

  async enqueueSpotifyCollection(
    resource: SpotifyResource,
    requestedBy: string,
    requestedByUid?: string,
  ): Promise<PlaylistEnqueueResult> {
    return this.#withExpansionSlot(async () => {
      const stopEpoch = this.#stopEpoch;
      if (!this.#spotifyResolver) {
        throw new UserError(
          "Spotify no está configurado en este bot: pegá un link de YouTube o SoundCloud, o buscá con !yt.",
        );
      }
      if (resource.type !== "playlist" && resource.type !== "album") {
        throw new UserError(
          "Solo se pueden expandir colecciones de Spotify con !play.",
        );
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
      if (stopEpoch !== this.#stopEpoch) {
        return {
          added: [],
          ...(expansion.total === undefined
            ? {}
            : { remaining: expansion.total }),
        };
      }
      const added: Track[] = [];
      let duplicates = 0;
      let halted = false;
      const addedIds = new Set<string>();
      for (const spotifyTrack of expansion.tracks.slice(
        0,
        this.#playlistMaxTracks,
      )) {
        if (this.#stopEpoch !== stopEpoch) {
          halted = true;
          break;
        }
        const query = `${spotifyTrack.artist} ${spotifyTrack.title}`.trim();
        if (!query || addedIds.has(spotifyTrack.id)) {
          duplicates++;
          continue;
        }
        try {
          const track = this.#enqueueMetadata(
            {
              durationSeconds: spotifyTrack.durationSeconds,
              id: spotifyTrack.id,
              title: spotifyTrack.title,
              webpageUrl: `https://open.spotify.com/track/${spotifyTrack.id}`,
            },
            requestedBy,
            "spotify",
            requestedByUid,
            query,
          );
          addedIds.add(track.id);
          added.push(track);
        } catch (error) {
          if (error instanceof QueueLimitError) {
            halted = true;
            break;
          }
          if (
            error instanceof Error &&
            /ya está en la cola/i.test(error.message)
          ) {
            duplicates++;
            continue;
          }
          throw error;
        }
      }
      return {
        added,
        ...(halted || expansion.total !== undefined
          ? {
              remaining: Math.max(
                0,
                (expansion.total ?? expansion.tracks.length) -
                  added.length -
                  duplicates,
              ),
            }
          : {}),
      };
    });
  }

  #enqueueMetadata(
    metadata: YoutubeTrackMetadata,
    requestedBy: string,
    alternativeProvider?: string,
    requestedByUid?: string,
    searchQuery?: string,
  ): Track {
    const track: Track = {
      id: metadata.id,
      requestedBy,
      ...(requestedByUid === undefined
        ? {}
        : { requestedByUid: requestedByUid }),
      ...(searchQuery === undefined ? {} : { searchQuery }),
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
    if (this.#queue.length >= this.#maxQueueTracks) {
      throw new QueueLimitError(
        `La cola está llena (máximo ${this.#maxQueueTracks} pistas).`,
      );
    }
    const requesterCount =
      (this.#current !== undefined &&
      requestedByUid !== undefined &&
      this.#current.requestedByUid === requestedByUid
        ? 1
        : this.#current !== undefined &&
            requestedByUid === undefined &&
            this.#current.requestedBy === requestedBy
          ? 1
          : 0) +
      this.#queue
        .snapshot()
        .filter((queued) =>
          requestedByUid !== undefined
            ? queued.requestedByUid === requestedByUid
            : queued.requestedBy === requestedBy,
        ).length;
    if (requesterCount >= this.#maxTracksPerUser) {
      throw new QueueLimitError(
        `Límite de ${this.#maxTracksPerUser} pistas por usuario en la cola.`,
      );
    }
    if (metadata.audioUrl) this.#cacheAudioUrl(track, metadata.audioUrl);
    this.#queue.add(track);
    if (!this.#current) this.#prefetchNext();
    this.#requestNext();
    this.#persistState();
    if (this.#current && this.#isSessionStable()) this.#prefetchNext();
    return track;
  }

  #invalidatePrepared(source: string): void {
    this.#prepared.get(source)?.abort?.abort();
    this.#prepared.delete(source);
  }

  #abortAllPrepared(): void {
    for (const entry of this.#prepared.values()) entry.abort?.abort();
    this.#prepared.clear();
  }

  skip(): void {
    this.#generation++;
    this.#pendingSkips++;
    this.#pendingSeek = undefined;
    this.#discardWarmStream();
    if (this.#current) this.#invalidatePrepared(this.#current.source);
    if (this.#session) this.#sessionEndReasons.set(this.#session, "skipped");
    this.#session?.stop();
    this.#session = undefined;
    this.#requestNext();
  }

  stop(persistState = true): void {
    this.#persistenceSuppressed = !persistState;
    this.#generation++;
    this.#stopEpoch++;
    this.#pendingSkips = 0;
    this.#pendingSeek = undefined;
    this.#discardWarmStream();
    if (this.#session) this.#sessionEndReasons.set(this.#session, "stopped");
    this.#session?.stop();
    this.#session = undefined;
    this.#current = undefined;
    this.#queue.clear();
    this.#loopMode = "off";
    this.#loopPool = [];
    this.#abortAllPrepared();
    if (persistState) this.#persistState();
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
    this.#generation++;
    if (this.#session) this.#sessionEndReasons.set(this.#session, "skipped");
    this.#session?.stop();
    this.#session = undefined;
    try {
      this.#queue.add(this.#current);
      this.#queue.moveToHead(this.#current.id);
    } catch {
      // Duplicate already queued: the seek acts like a skip.
    }
    this.#requestNext();
  }

  replayPrevious(): Track {
    const previous = this.#history[this.#current ? 1 : 0];
    if (!previous) {
      throw new UserError("No hay ninguna canción anterior para repetir.");
    }
    try {
      this.#queue.add(previous);
    } catch {
      // Already queued: move it to the front instead.
    }
    this.#queue.moveToHead(previous.id);
    this.#requestNext();
    this.#persistState();
    return previous;
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
    if (removed) this.#invalidatePrepared(removed.source);
    if (removed) this.#persistState();
    return removed;
  }

  clearQueued(): number {
    const count = this.#queue.length;
    this.#generation++;
    this.#stopEpoch++;
    this.#pendingSkips = 0;
    this.#pendingSeek = undefined;
    this.#discardWarmStream();
    this.#queue.clear();
    this.#loopMode = "off";
    this.#loopPool = [];
    this.#abortAllPrepared();
    this.#persistState();
    return count;
  }

  shuffleQueued(): number {
    const count = this.#queue.length;
    this.#queue.shuffle();
    this.#persistState();
    return count;
  }

  #recordHistory(track: Track): void {
    this.#history.unshift(track);
    if (this.#history.length > HISTORY_LIMIT)
      this.#history.length = HISTORY_LIMIT;
  }

  #persistState(): void {
    if (this.#persistenceSuppressed) return;
    this.#safeObserver(() => {
      this.#stateStore?.save({
        loopMode: this.#loopMode,
        ...(this.#filter === "off" ? {} : { filter: this.#filter }),
        queue: this.#serializedQueue(),
        volumePercent: this.#volumePercent,
      });
    });
  }

  async flushState(): Promise<void> {
    await this.#stateStore?.flush();
  }

  #serializedQueue(): readonly SerializedQueueTrack[] {
    const entries: SerializedQueueTrack[] = [];
    const include = (track: Track): void => {
      entries.push({
        ...(track.durationSeconds === undefined
          ? {}
          : { durationSeconds: track.durationSeconds }),
        id: track.id,
        requestedBy: track.requestedBy,
        ...(track.requestedByUid === undefined
          ? {}
          : { requestedByUid: track.requestedByUid }),
        ...(track.searchQuery === undefined
          ? {}
          : { searchQuery: track.searchQuery }),
        source: track.source,
        title: track.title,
      });
    };
    if (this.#current) include(this.#current);
    for (const track of this.#queue.snapshot()) include(track);
    return entries;
  }

  #requestNext(): void {
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
            if (dropped) this.#invalidatePrepared(dropped.source);
          }
        }
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
          this.#persistState();
          return;
        }
        const generation = ++this.#generation;
        this.#current = track;
        this.#persistState();
        const audioResolutionStartedAt = Date.now();
        const resolved = await this.#resolveOrSkip(track, generation);
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
          this.#prepared.delete(track.source);
          continue;
        }
        session.player.setVolume(volumeToGain(this.#volumePercent));
        this.#session = session;
        this.#tracksPlayed++;
        this.#recordHistory(track);
        this.#safeObserver(() => this.#onPlaybackStarted(track));
        this.#prefetchWhenStable();
        this.#prewarmNext();
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
        }
        if (generation !== this.#generation || this.#current !== track) {
          continue;
        }
        this.#prepared.delete(track.source);
        this.#session = undefined;
        this.#current = undefined;
        this.#persistState();
        if (this.#loopMode === "track") {
          try {
            this.#queue.add(track);
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
      this.#invalidatePrepared(track.source);
      // A skip that landed while this track was resolving consumed this track.
      // Do not let that same skip drop an extra queued track in the next loop.
      if (this.#pendingSkips > 0) this.#pendingSkips--;
      return undefined;
    };
    try {
      const resolved = await this.#getAudioUrl(track);
      if (generation !== this.#generation || this.#current !== track) {
        return discardInFlight();
      }
      return resolved;
    } catch (error) {
      if (generation !== this.#generation || this.#current !== track) {
        return discardInFlight();
      }
      const playbackError =
        error instanceof Error ? error : new Error(String(error));
      this.#reportPlaybackError(track, playbackError);
      this.#invalidatePrepared(track.source);
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

  #cacheAudioUrl(track: Track, url: string): void {
    const expiresAt = audioUrlExpiresAt(url);
    this.#prepared.set(track.source, {
      expiresAt,
      origin: "inline-resolve",
      promise: Promise.resolve({ expiresAt, url }),
      status: "ready",
    });
  }

  #getAudioUrl(track: Track): Promise<{
    audioUrlSource: AudioUrlSource;
    cacheHit: boolean;
    prefetchStatus: PrefetchStatus;
    url: string;
  }> {
    const cached = this.#prepared.get(track.source);
    if (cached) {
      if (cached.expiresAt > Date.now()) {
        const prefetchStatus =
          cached.origin === "prefetch"
            ? cached.status === "pending"
              ? ("in-flight" as const)
              : ("hit" as const)
            : ("not-applicable" as const);
        return cached.promise.then((prepared) => ({
          audioUrlSource: cached.origin,
          cacheHit: true,
          prefetchStatus,
          url: prepared.url,
        }));
      }
      this.#invalidatePrepared(track.source);
      return this.#resolveAudioUrl(track).then((url) => ({
        audioUrlSource: "inline-resolve" as const,
        cacheHit: false,
        prefetchStatus: "miss" as const,
        url,
      }));
    }
    return this.#resolveAudioUrl(track).then((url) => ({
      audioUrlSource: "inline-resolve" as const,
      cacheHit: false,
      prefetchStatus: "miss" as const,
      url,
    }));
  }

  #resolveAudioUrl(
    track: Track,
    origin: AudioUrlSource = "inline-resolve",
  ): Promise<string> {
    const existing = this.#prepared.get(track.source);
    if (existing !== undefined) {
      return existing.promise.then((prepared) => prepared.url);
    }
    const abort = new AbortController();
    const pending = this.#resolvePlayableAudio(track, abort.signal).then(
      (url) => {
        const expiresAt = audioUrlExpiresAt(url);
        const entry = this.#prepared.get(track.source);
        if (entry) entry.expiresAt = expiresAt;
        return { expiresAt, url };
      },
    );
    const entry: PreparedAudioEntry = {
      abort,
      expiresAt: Number.POSITIVE_INFINITY,
      origin,
      promise: pending,
      status: "pending",
    };
    pending.catch(() => {
      if (this.#prepared.get(track.source) === entry) {
        this.#prepared.delete(track.source);
      }
    });
    this.#prepared.set(track.source, entry);
    return pending.then((prepared) => {
      entry.status = "ready";
      return prepared.url;
    });
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
      return this.#directUrlResolver.getAudioUrl(track.source);
    }
    if (this.#soundcloudResolver?.match(track.source)) {
      return this.#soundcloudResolver.getAudioUrl(track.source);
    }
    let lastError: unknown;
    try {
      const url = await this.#resolver.getAudioUrlFromUrl(track.source, signal);
      this.#audioUrlCache?.set(track.source, url, audioUrlExpiresAt(url));
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
        this.#audioUrlCache?.set(
          fallbackResult.source,
          fallbackResult.url,
          audioUrlExpiresAt(fallbackResult.url),
        );
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

  #prefetchNext(): void {
    const queueSnapshot = this.#queue.snapshot();
    const isPlaylist = queueSnapshot.length > 10;
    const prefetchDepth = isPlaylist ? PLAYLIST_PREFETCH_DEPTH : PREFETCH_DEPTH;
    const prefetchSlice = queueSnapshot.slice(0, prefetchDepth);

    const toResolve: Array<{ track: Track; index: number }> = [];
    for (const [index, next] of prefetchSlice.entries()) {
      const existing = this.#prepared.get(next.source);
      if (existing !== undefined) {
        if (existing.expiresAt > Date.now() + AUDIO_URL_REFRESH_AHEAD_MS) {
          continue;
        }
        this.#invalidatePrepared(next.source);
      }
      toResolve.push({ track: next, index });
    }

    if (isPlaylist && toResolve.length > PLAYLIST_PREFETCH_BATCH) {
      const immediate = toResolve.slice(0, PLAYLIST_PREFETCH_BATCH);
      const deferred = toResolve.slice(PLAYLIST_PREFETCH_BATCH);
      const stopEpoch = this.#stopEpoch;
      const queueSnapshotIds = new Set(
        queueSnapshot.map((queued) => queued.id),
      );
      for (const { track } of immediate) {
        void this.#resolveAudioUrl(track, "prefetch").catch(() => {
          this.#invalidatePrepared(track.source);
        });
      }
      setTimeout(() => {
        if (stopEpoch !== this.#stopEpoch) return;
        for (const { track } of deferred) {
          if (!queueSnapshotIds.has(track.id)) continue;
          const stillPrepared = this.#prepared.get(track.source);
          if (
            stillPrepared === undefined ||
            stillPrepared.expiresAt <= Date.now() + AUDIO_URL_REFRESH_AHEAD_MS
          ) {
            void this.#resolveAudioUrl(track, "prefetch").catch(() => {
              this.#invalidatePrepared(track.source);
            });
          }
        }
      }, 2_000);
    } else {
      for (const { track } of toResolve) {
        void this.#resolveAudioUrl(track, "prefetch").catch(() => {
          this.#invalidatePrepared(track.source);
        });
      }
    }
  }

  #isSessionStable(): boolean {
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
        this.#prefetchNext();
        return;
      }
      setTimeout(check, PREFETCH_STABILITY_POLL_MS);
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
    const stopEpoch = this.#stopEpoch;
    const generation = this.#generation;
    void this.#resolveAudioUrl(next)
      .then((url) => {
        if (stopEpoch !== this.#stopEpoch || generation !== this.#generation) {
          return undefined;
        }
        this.#loudnessProfiler?.measure(next.source, url);
        if (
          this.#current === undefined ||
          this.#queue.snapshot()[0]?.source !== next.source
        ) {
          return undefined;
        }
        const stream = this.#createPcmStream(url, {
          audioFilter: { name: this.#filter, param: this.#filterParam },
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
        metadata.title,
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

export function audioUrlExpiresAt(url: string): number {
  try {
    const parsed = new URL(url);
    const queryExpire = Number(parsed.searchParams.get("expire"));
    if (Number.isFinite(queryExpire) && queryExpire > 0) {
      return queryExpire * 1_000 - AUDIO_URL_EXPIRY_MARGIN_MS;
    }
    const pathExpire = Number(/\/expire\/(\d+)/.exec(parsed.pathname)?.[1]);
    if (Number.isFinite(pathExpire) && pathExpire > 0) {
      return pathExpire * 1_000 - AUDIO_URL_EXPIRY_MARGIN_MS;
    }
  } catch {
    // The resolver already validates URLs; use a conservative TTL if parsing fails.
  }
  return Date.now() + AUDIO_URL_FALLBACK_TTL_MS;
}
