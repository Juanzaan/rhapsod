import { parseMediaInput } from "../media/media-input.js";
import type { RedirectResolver } from "../media/redirect-resolver.js";
import type {
  PlaylistExpansion,
  YoutubeTrackMetadata,
} from "../media/youtube/yt-dlp.js";
import type { YoutubeResource } from "../media/media-input.js";
import type { Track } from "../domain/track.js";
import { DuplicateTrackError } from "../domain/playback-queue.js";
import { QueueLimitError, TrackQueue } from "./track-queue.js";
import {
  AUTOPLAY_REQUESTER,
  AUTOPLAY_UID,
  autoplayBucketOrder,
  pickAutoplayTrack,
  weightedPick,
  type AutoplayBucket,
  type AutoplayCandidate,
  type AutoplayProfile,
  type AutoplayProfileSource,
  type LastPlayedTrack,
} from "./autoplay-picker.js";
import { fetchAutoplayVideoId } from "../media/youtube/innertube-related.js";
import type { createPcmStream, playFfmpegUrl } from "../audio/ffmpeg-player.js";
import type { LoudnessProfiler } from "../audio/loudness-profiler.js";
import type { NonMusicSegmentSource } from "../media/youtube/non-music-segments.js";
import type { RhapsodOpusEncoder } from "../audio/opus-encoder.js";
import type { VoiceFrameOutput } from "../audio/audio-player.js";
import type { AudioPlayerMetrics } from "../audio/audio-player.js";
import type { AlternativeSourceResolver } from "../media/song-link.js";
import {
  isAppleMusicPlaylist,
  type AppleMusicResolver,
} from "../media/apple-music.js";
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
import { parseMusicQuery } from "../lib/query-parser.js";
import { UserError } from "../lib/user-error.js";
import { isDrmError } from "../lib/drm-error.js";
import { PreparedAudioStore } from "./prepared-audio-store.js";
import {
  PlaybackController,
  type AutoplayPick,
  type LoopMode,
  type PlaybackDriverState,
  type PlaybackEndReason,
  type PlaybackKpis,
  type PlaybackTiming,
} from "./playback-controller.js";
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
import { messages } from "../lib/messages.js";

interface PlaybackServiceOptions {
  readonly encoder: RhapsodOpusEncoder;
  readonly resolver: YoutubePlaybackResolver;
  readonly alternativeResolver?: AlternativeSourceResolver;
  readonly appleMusicResolver?: AppleMusicResolver;
  readonly directUrlResolver?: DirectUrlResolver;
  readonly soundcloudResolver?: SoundCloudResolver;
  readonly spotifyResolver?: SpotifyResolver;
  readonly lyricsResolver?: LyricsResolver;
  readonly autoplayProfile?: AutoplayProfileSource;
  readonly autoplayTimeoutMs?: number;
  readonly autoplayRandom?: () => number;
  readonly relatedVideoId?: (
    seedVideoId: string,
  ) => Promise<string | undefined>;
  readonly stateStore?: PlaybackStateStore;
  readonly audioUrlCache?: AudioUrlCache;
  readonly redirectResolver?: RedirectResolver;
  readonly tuneInStreamUrl?: (url: string) => Promise<string | undefined>;
  readonly playlistStore?: PlaylistStore;
  readonly output: VoiceFrameOutput;
  readonly playlistMaxTracks?: number;
  readonly maxQueueTracks?: number;
  readonly maxTracksPerUser?: number;
  readonly createPlayback?: typeof playFfmpegUrl;
  readonly createPcmStream?: typeof createPcmStream;
  readonly proxyUrl?: string;
  readonly prewarmNext?: boolean;
  readonly loudnessProfiler?: LoudnessProfiler;
  readonly nonMusicSegments?: NonMusicSegmentSource;
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
}

export interface YoutubePlaybackResolver {
  getAudioUrlFromUrl(url: string, signal?: AbortSignal): Promise<string>;
  invalidateAudioUrl?(url: string): Promise<boolean>;
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

export type { LoopMode } from "./playback-controller.js";
export { volumeToGain } from "./playback-controller.js";

interface PlaylistEnqueueResult {
  readonly added: readonly Track[];
  readonly remaining?: number;
}

const DEFAULT_PLAYLIST_MAX_TRACKS = 100;
// Resolutions whose track was never queued (a failed or rejected add) must
// not grow the request-time map for the life of the process.
const MAX_PENDING_REQUESTS = 50;
const AUTOPLAY_MIX_LIMIT = 25;
const AUTOPLAY_SEED_LIMIT = 3;
// Pool sizes for the DJ buckets and how long a fetched YouTube mix is
// reused: a mix call is a yt-dlp run, and the same seed feeds several turns.
const AUTOPLAY_CLASSIC_POOL = 40;
const AUTOPLAY_CLASSIC_ATTEMPTS = 3;
const AUTOPLAY_DISCOVER_ARTISTS = 8;
const AUTOPLAY_DISCOVER_ATTEMPTS = 2;
const AUTOPLAY_MIX_CACHE_TTL_MS = 30 * 60_000;
const AUTOPLAY_MIX_CACHE_MAX = 24;
// Turns a bucket sits out after the channel skips one of its picks.
const AUTOPLAY_SKIP_COOLDOWN = 2;
const YOUTUBE_VIDEO_ID_RE =
  /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]{11})/;

interface AutoplayContext {
  readonly lastTrack: LastPlayedTrack | undefined;
  readonly profile: AutoplayProfile;
  readonly recentArtists: readonly string[];
  readonly recentIds: ReadonlySet<string>;
  readonly seeds: readonly string[];
}

function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

function youtubeVideoIdFromSource(source: string): string | undefined {
  return YOUTUBE_VIDEO_ID_RE.exec(source)?.[1];
}

// Kept here so existing importers (tests) keep working; the implementation
// lives with the store that uses it.
export { audioUrlExpiresAt } from "./prepared-audio-store.js";

export class YoutubePlaybackService {
  readonly #requestedAt = new Map<string, number>();
  readonly #queue: TrackQueue;
  readonly #controller: PlaybackController;
  readonly #resolver: YoutubePlaybackResolver;
  readonly #alternativeResolver: AlternativeSourceResolver | undefined;
  readonly #appleMusicResolver: AppleMusicResolver | undefined;
  readonly #directUrlResolver: DirectUrlResolver | undefined;
  readonly #soundcloudResolver: SoundCloudResolver | undefined;
  readonly #spotifyResolver: SpotifyResolver | undefined;
  readonly #lyricsResolver: LyricsResolver | undefined;
  readonly #autoplayProfile: AutoplayProfileSource | undefined;
  #autoplayUid: string | undefined;
  readonly #autoplayRandom: () => number;
  #autoplayTurn = 0;
  readonly #bucketCooldowns = new Map<AutoplayBucket, number>();
  readonly #autoplayBuckets = new Map<string, AutoplayBucket>();
  readonly #mixCache = new Map<
    string,
    { readonly at: number; readonly candidates: readonly AutoplayCandidate[] }
  >();
  readonly #relatedVideoId: (
    seedVideoId: string,
  ) => Promise<string | undefined>;
  readonly #stateStore: PlaybackStateStore | undefined;
  readonly #onTiming: (timing: PlaybackTiming) => void;
  readonly #redirectResolver: RedirectResolver | undefined;
  readonly #tuneInStreamUrl:
    ((url: string) => Promise<string | undefined>) | undefined;
  readonly #playlistStore: PlaylistStore | undefined;
  readonly #playlistMaxTracks: number;
  #expansionActive = false;
  #persistenceSuppressed = false;
  readonly #preparedStore: PreparedAudioStore;

  constructor(options: PlaybackServiceOptions) {
    this.#resolver = options.resolver;
    this.#alternativeResolver = options.alternativeResolver;
    this.#appleMusicResolver = options.appleMusicResolver;
    this.#directUrlResolver = options.directUrlResolver;
    this.#soundcloudResolver = options.soundcloudResolver;
    this.#spotifyResolver = options.spotifyResolver;
    this.#lyricsResolver = options.lyricsResolver;
    this.#autoplayProfile = options.autoplayProfile;
    this.#autoplayRandom = options.autoplayRandom ?? (() => Math.random());
    this.#relatedVideoId = options.relatedVideoId ?? fetchAutoplayVideoId;
    this.#stateStore = options.stateStore;
    this.#onTiming = options.onTiming ?? (() => undefined);
    this.#preparedStore = new PreparedAudioStore({
      ...(options.audioUrlCache === undefined
        ? {}
        : { cache: options.audioUrlCache }),
    });
    this.#redirectResolver = options.redirectResolver;
    this.#tuneInStreamUrl = options.tuneInStreamUrl;
    this.#playlistStore = options.playlistStore;
    this.#playlistMaxTracks =
      options.playlistMaxTracks ?? DEFAULT_PLAYLIST_MAX_TRACKS;
    this.#queue = new TrackQueue({
      ...(options.maxQueueTracks === undefined
        ? {}
        : { maxQueueTracks: options.maxQueueTracks }),
      ...(options.maxTracksPerUser === undefined
        ? {}
        : { maxTracksPerUser: options.maxTracksPerUser }),
    });
    const restored = this.#stateStore?.load();
    this.#controller = new PlaybackController({
      autoplayProvider: () => this.planAutoplayTrack(),
      ...(options.autoplayTimeoutMs === undefined
        ? {}
        : { autoplayTimeoutMs: options.autoplayTimeoutMs }),
      ...(options.createPlayback === undefined
        ? {}
        : { createPlayback: options.createPlayback }),
      ...(options.createPcmStream === undefined
        ? {}
        : { createPcmStream: options.createPcmStream }),
      ...(options.directUrlResolver === undefined
        ? {}
        : { directUrlResolver: options.directUrlResolver }),
      encoder: options.encoder,
      ...(restored?.autoplay === true ? { initialAutoplay: true } : {}),
      ...(restored?.loopMode === undefined
        ? {}
        : { initialLoopMode: restored.loopMode }),
      ...(restored?.volumePercent === undefined
        ? {}
        : { initialVolumePercent: restored.volumePercent }),
      ...(options.loudnessProfiler === undefined
        ? {}
        : { loudnessProfiler: options.loudnessProfiler }),
      ...(options.nonMusicSegments === undefined
        ? {}
        : { nonMusicSegments: options.nonMusicSegments }),
      ...(options.onPlaybackError === undefined
        ? {}
        : { onPlaybackError: options.onPlaybackError }),
      onPlaybackFinished: (track, metrics, reason, kpis) => {
        this.#noteAutoplayFinish(track, reason);
        options.onPlaybackFinished?.(track, metrics, reason, kpis);
      },
      ...(options.onPlaybackStarted === undefined
        ? {}
        : { onPlaybackStarted: options.onPlaybackStarted }),
      onStateChanged: () => this.#persistState(),
      ...(options.onTiming === undefined ? {} : { onTiming: options.onTiming }),
      output: options.output,
      ...(restored?.queue === undefined
        ? {}
        : { persistedQueue: restored.queue }),
      preparedStore: this.#preparedStore,
      ...(options.prewarmNext === undefined
        ? {}
        : { prewarmNext: options.prewarmNext }),
      ...(options.proxyUrl === undefined ? {} : { proxyUrl: options.proxyUrl }),
      queue: this.#queue,
      resolver: options.resolver,
      ...(options.soundcloudResolver === undefined
        ? {}
        : { soundcloudResolver: options.soundcloudResolver }),
    });
  }

  get current(): Track | undefined {
    return this.#controller.current;
  }

  queue(): readonly Track[] {
    return this.#queue.snapshot();
  }

  get tracksPlayed(): number {
    return this.#controller.tracksPlayed;
  }

  get volume(): number {
    return this.#controller.volume;
  }

  setVolume(percent: number): void {
    this.#controller.setVolume(percent);
  }

  get loopMode(): LoopMode {
    return this.#controller.loopMode;
  }

  get playerState(): "idle" | "buffering" | "playing" | "paused" {
    return this.#controller.playerState;
  }

  get driverState(): PlaybackDriverState {
    return this.#controller.driverState;
  }

  get playbackPositionMs(): number {
    return this.#controller.playbackPositionMs;
  }

  get audioHealth(): AudioPlayerMetrics | undefined {
    return this.#controller.audioHealth;
  }

  setLoopMode(mode: LoopMode): void {
    this.#controller.setLoopMode(mode);
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
        throw new UserError(messages.enqueueLosArchivosLocalesNo);
      }
      return this.enqueueSearch(media.value, requestedBy, requestedByUid);
    }
    if (media.kind === "spotify") {
      if (!this.#spotifyResolver) {
        throw new UserError(messages.enqueueSpotifyNoEstaConfigurado);
      }
      if (media.resource.type !== "track") {
        throw new UserError(messages.enqueueLasPlaylistsYAlbumes);
      }
      const spotifyTrack = await this.#spotifyResolver.getTrack(media.resource);
      const query = `${spotifyTrack.artist} ${spotifyTrack.title}`.trim();
      if (!query) {
        throw new UserError(messages.enqueueNoEncontreLosDatos);
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
      // TuneIn pages and short links hold no audio themselves: resolve the
      // station id to its stream first, then intake it as a direct URL.
      const tuneInStream = await this.#tuneInStreamUrl?.(media.value);
      if (tuneInStream !== undefined) {
        return this.enqueue(tuneInStream, requestedBy, requestedByUid);
      }
      throw new UserError(messages.enqueueNoReconozcoEseLink);
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
          throw new UserError(messages.enqueueNoPudeEncontrarEse);
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
    if (media.kind === "apple-music") {
      if (isAppleMusicPlaylist(media.value)) {
        throw new UserError(messages.enqueueLasPlaylistsDeApple);
      }
      if (!this.#appleMusicResolver) {
        throw new UserError(messages.enqueueEsteBotNoTiene);
      }
      const appleTrack = await this.#appleMusicResolver.getTrack(media.value);
      const query = `${appleTrack.artist} ${appleTrack.title}`.trim();
      if (!query) {
        throw new UserError(messages.enqueueNoEncontreLosDatos2);
      }
      const metadata = await this.#resolver.search(
        query,
        appleTrack.durationSeconds,
        appleTrack.title,
      );
      this.#recordMetadataTiming(metadata, startedAt);
      return this.#enqueueMetadata(
        metadata,
        requestedBy,
        "apple-music",
        requestedByUid,
      );
    }
    if (media.kind === "amazon-music") {
      const result = await this.enqueueMusicLink(
        media.value,
        requestedBy,
        requestedByUid,
      );
      const first = result.added[0];
      if (!first) {
        throw new UserError(messages.enqueueNoPudeEncontrarEsa);
      }
      return first;
    }
    if (media.kind !== "youtube" || media.resource.type !== "video") {
      throw new UserError(messages.enqueueSoloSeSoportanVideos);
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

  async enqueueSoundcloudSearch(
    query: string,
    requestedBy: string,
    requestedByUid?: string,
  ): Promise<Track> {
    const startedAt = Date.now();
    const results =
      (await this.#soundcloudResolver?.searchTracks?.(query, 5)) ?? [];
    const top = results[0];
    if (!top) {
      throw new UserError(
        messages.enqueueSoundcloudSearchNoEncontreEsaBusqueda,
      );
    }
    const metadata: YoutubeTrackMetadata = {
      ...(top.durationSeconds === undefined
        ? {}
        : { durationSeconds: top.durationSeconds }),
      id: top.id,
      title: `${top.artist} - ${top.title}`,
      webpageUrl: top.url,
    };
    this.#recordMetadataTiming(metadata, startedAt);
    return this.#enqueueMetadata(
      metadata,
      requestedBy,
      "soundcloud",
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
      throw new UserError(messages.enqueueSearchIndexNoHayResultadoPara(index));
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
      throw new UserError(messages.enqueueNextLasPlaylistsSeEncolan);
    }
    const track = await this.enqueue(input, requestedBy, requestedByUid);
    this.#queue.moveToHead(track.id);
    if (this.#controller.current) this.#controller.prefetchNext();
    this.#persistState();
    return track;
  }

  restoreQueuedTracks(connectedUids: readonly string[]): number {
    return this.#controller.restoreQueuedTracks(connectedUids);
  }

  moveQueued(fromPosition: number, toPosition: number): Track | undefined {
    const moved = this.#queue.move(fromPosition, toPosition);
    if (moved && this.#controller.current) this.#controller.prefetchNext();
    this.#persistState();
    return moved;
  }

  removeQueuedRange(fromPosition: number, toPosition: number): Track[] {
    const removed = this.#queue.removeRange(fromPosition, toPosition);
    for (const track of removed) this.#preparedStore.invalidate(track.source);
    this.#persistState();
    return removed;
  }

  history(): readonly Track[] {
    return this.#controller.history();
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
      throw new UserError(messages.savePlaylistLaColaEstaVacia);
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
      throw new UserError(messages.loadPlaylistNoEncontreLaPlaylist(rawName));
    }
    if (playlist.tracks.length === 0) {
      throw new UserError(messages.loadPlaylistLaPlaylistEstaVacia(rawName));
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
        if (error instanceof DuplicateTrackError) {
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
      throw new UserError(messages.resolvePlaylistTracksSoloSeSoportanUrls);
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
      throw new UserError(messages.requirePlaylistStoreLasPlaylistsNoEstan);
    }
    return this.#playlistStore;
  }

  async getLyrics(): Promise<TrackLyrics | undefined> {
    if (!this.#lyricsResolver || !this.#controller.current) return undefined;
    const parsed = parseArtistTitle(this.#controller.current.title);
    return this.#lyricsResolver.search(parsed.artist, parsed.title);
  }

  async enqueuePlaylist(
    resource: YoutubeResource,
    requestedBy: string,
    requestedByUid?: string,
  ): Promise<PlaylistEnqueueResult> {
    if (resource.type !== "playlist")
      throw new UserError(messages.enqueuePlaylistSoloSePuedenExpandir);
    return this.#withExpansionSlot(async () => {
      const stopEpoch = this.#controller.captureStopEpoch();
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
      const stopEpoch = this.#controller.captureStopEpoch();
      if (!this.#alternativeResolver) {
        throw new UserError(messages.enqueueMusicLinkEsteBotNoTiene);
      }
      const alternative =
        await this.#alternativeResolver.findAlternative(input);
      if (!this.#controller.isStopEpochCurrent(stopEpoch)) {
        return { added: [] };
      }
      if (!alternative) {
        throw new UserError(messages.enqueueMusicLinkNoPudeEncontrarEse);
      }
      if (alternative.provider === "soundcloud") {
        if (!this.#soundcloudResolver) {
          throw new UserError(messages.enqueueMusicLinkElLinkSoloExiste);
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
      throw new UserError(messages.enqueueMusicLinkElLinkAlternativoNo);
    });
  }

  #enqueuePlaylistExpansion(
    expansion: PlaylistExpansion,
    requestedBy: string,
    requestedByUid?: string,
    stopEpoch = this.#controller.captureStopEpoch(),
  ): PlaylistEnqueueResult {
    const added: Track[] = [];
    let duplicates = 0;
    let halted = false;
    const addedIds = new Set<string>();
    for (const metadata of expansion.tracks.slice(0, this.#playlistMaxTracks)) {
      if (!this.#controller.isStopEpochCurrent(stopEpoch)) {
        halted = true;
        break;
      }
      if (
        addedIds.has(metadata.id) ||
        this.#controller.current?.id === metadata.id
      ) {
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
        if (error instanceof DuplicateTrackError) {
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
      throw new UserError(messages.withExpansionSlotYaHayUnaPlaylist);
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
      const stopEpoch = this.#controller.captureStopEpoch();
      if (!this.#spotifyResolver) {
        throw new UserError(
          messages.enqueueSpotifyCollectionSpotifyNoEstaConfigurado,
        );
      }
      if (resource.type !== "playlist" && resource.type !== "album") {
        throw new UserError(
          messages.enqueueSpotifyCollectionSoloSePuedenExpandir,
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
      if (!this.#controller.isStopEpochCurrent(stopEpoch)) {
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
        if (!this.#controller.isStopEpochCurrent(stopEpoch)) {
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
          if (error instanceof DuplicateTrackError) {
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

  async enqueueAppleMusicCollection(
    input: string,
    requestedBy: string,
    requestedByUid?: string,
  ): Promise<PlaylistEnqueueResult> {
    return this.#withExpansionSlot(async () => {
      const stopEpoch = this.#controller.captureStopEpoch();
      if (!this.#appleMusicResolver) {
        throw new UserError(messages.enqueueAppleMusicCollectionEsteBotNoTiene);
      }
      const playlist = await this.#appleMusicResolver.getPlaylist(input);
      if (!this.#controller.isStopEpochCurrent(stopEpoch)) {
        return { added: [], remaining: playlist.tracks.length };
      }
      const added: Track[] = [];
      let duplicates = 0;
      let halted = false;
      const addedIds = new Set<string>();
      for (const appleTrack of playlist.tracks.slice(
        0,
        this.#playlistMaxTracks,
      )) {
        if (!this.#controller.isStopEpochCurrent(stopEpoch)) {
          halted = true;
          break;
        }
        const query = `${appleTrack.artist} ${appleTrack.title}`.trim();
        const id = `apple:${appleTrack.id}`;
        if (!query || addedIds.has(id)) {
          duplicates++;
          continue;
        }
        try {
          const track = this.#enqueueMetadata(
            {
              ...(appleTrack.durationSeconds === undefined
                ? {}
                : { durationSeconds: appleTrack.durationSeconds }),
              id,
              title: `${appleTrack.artist} - ${appleTrack.title}`,
              webpageUrl:
                appleTrack.url ??
                `https://music.apple.com/song/${appleTrack.id}`,
            },
            requestedBy,
            "apple-music",
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
          if (error instanceof DuplicateTrackError) {
            duplicates++;
            continue;
          }
          throw error;
        }
      }
      return {
        added,
        ...(halted
          ? {
              remaining: Math.max(
                0,
                playlist.tracks.length - added.length - duplicates,
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
    if (metadata.audioUrl)
      this.#preparedStore.setReady(track, metadata.audioUrl);
    const requestedAt = this.#requestedAt.get(metadata.id);
    if (requestedAt !== undefined) {
      this.#requestedAt.delete(metadata.id);
      this.#controller.noteRequested(track, requestedAt);
    }
    this.#queue.add(track, this.#controller.current);
    if (!this.#controller.current) this.#controller.prefetchNext();
    this.#controller.requestNext();
    this.#persistState();
    if (this.#controller.current && this.#controller.isSessionStable())
      this.#controller.prefetchNext();
    return track;
  }

  skip(): void {
    this.#controller.skip();
  }

  jumpTo(position: number): void {
    this.#controller.jumpTo(position);
  }

  get autoplayEnabled(): boolean {
    return this.#controller.autoplayEnabled;
  }

  setAutoplay(enabled: boolean): void {
    this.#controller.setAutoplayEnabled(enabled);
  }

  async resolveAutoplayTrack(): Promise<Track | undefined> {
    const pick = await this.planAutoplayTrack();
    pick?.commit();
    return pick?.track;
  }

  // Picks without touching the rotation: the controller plans the next
  // autoplay track while the last queued one still plays, and a plan that
  // goes unused (someone queued, the track was skipped) must leave the turn,
  // cooldowns and remembered requester as they were.
  async planAutoplayTrack(): Promise<AutoplayPick | undefined> {
    const history = this.#controller.history();
    // Seeds that survive restarts: past user choices from the persisted
    // listening store backfill the in-memory session history, so autoplay
    // keeps following the channel's taste instead of going silent.
    const persistedSeeds =
      this.#autoplayProfile?.recentSeeds(AUTOPLAY_SEED_LIMIT) ?? [];
    const seeds: string[] = [];
    for (const track of history) {
      const videoId = youtubeVideoIdFromSource(track.source);
      if (videoId !== undefined && !seeds.includes(videoId))
        seeds.push(videoId);
      if (seeds.length >= AUTOPLAY_SEED_LIMIT) break;
    }
    for (const seed of persistedSeeds) {
      if (seeds.length >= AUTOPLAY_SEED_LIMIT) break;
      if (!seeds.includes(seed.id)) seeds.push(seed.id);
    }
    const seedUid =
      this.#resolveAutoplayUid(history) ??
      this.#autoplayProfile?.lastRequesterUid();
    const profile =
      seedUid === undefined
        ? {
            artistScores:
              this.#autoplayProfile?.artistScores() ??
              new Map<string, number>(),
            tokenScores: new Map<string, number>(),
          }
        : (this.#autoplayProfile?.tasteProfile(seedUid) ?? {
            artistScores: new Map<string, number>(),
            tokenScores: new Map<string, number>(),
          });
    const last = history[0] ?? persistedSeeds[0];
    const lastArtist =
      last === undefined ? undefined : parseArtistTitle(last.title).artist;
    const lastTrack =
      last === undefined
        ? undefined
        : {
            ...(lastArtist === undefined ? {} : { artist: lastArtist }),
            title: last.title,
          };
    const recentIds = new Set<string>();
    for (const track of history) recentIds.add(track.id);
    for (const seed of persistedSeeds) recentIds.add(seed.id);
    for (const track of this.#queue.snapshot()) recentIds.add(track.id);
    const current = this.#controller.current;
    if (current !== undefined) recentIds.add(current.id);
    const recentArtists = this.#autoplayProfile?.recentArtists(10) ?? [];
    const context: AutoplayContext = {
      lastTrack,
      profile,
      recentArtists,
      recentIds,
      seeds,
    };
    const order = autoplayBucketOrder(
      this.#autoplayTurn,
      this.#bucketCooldowns,
    );
    for (const bucket of order) {
      const picked = await this.#pickFromBucket(bucket, context).catch(
        () => undefined,
      );
      if (picked === undefined) continue;
      return {
        commit: () => this.#commitAutoplay(picked, bucket, seedUid),
        track: picked,
      };
    }
    return undefined;
  }

  #commitAutoplay(
    picked: Track,
    bucket: AutoplayBucket,
    seedUid: string | undefined,
  ): void {
    if (seedUid !== undefined) this.#autoplayUid = seedUid;
    for (const [cooling, turns] of this.#bucketCooldowns) {
      if (turns <= 1) this.#bucketCooldowns.delete(cooling);
      else this.#bucketCooldowns.set(cooling, turns - 1);
    }
    this.#autoplayTurn++;
    this.#autoplayBuckets.set(picked.id, bucket);
    if (this.#autoplayBuckets.size > 50) {
      const oldest = this.#autoplayBuckets.keys().next().value;
      if (oldest !== undefined) this.#autoplayBuckets.delete(oldest);
    }
  }

  // A skipped autoplay pick is the channel saying "not this": its bucket sits
  // out a couple of turns so the rotation leans on the others meanwhile.
  #noteAutoplayFinish(track: Track, reason: PlaybackEndReason): void {
    if (track.requestedByUid !== AUTOPLAY_UID) return;
    const bucket = this.#autoplayBuckets.get(track.id);
    this.#autoplayBuckets.delete(track.id);
    if (bucket !== undefined && reason === "skipped") {
      this.#bucketCooldowns.set(bucket, AUTOPLAY_SKIP_COOLDOWN);
    }
  }

  async #pickFromBucket(
    bucket: AutoplayBucket,
    context: AutoplayContext,
  ): Promise<Track | undefined> {
    if (bucket === "classic") return this.#pickClassic(context);
    if (bucket === "discover") return this.#pickDiscovery(context);
    for (const seed of context.seeds) {
      const mixed = await this.#expandAutoplayMix(
        seed,
        context.recentIds,
        context.recentArtists,
        context.profile,
        context.lastTrack,
      ).catch(() => undefined);
      if (mixed !== undefined) return mixed;
      const related = await this.#resolveRelatedVideo(
        seed,
        context.recentIds,
        context.recentArtists,
      ).catch(() => undefined);
      if (related !== undefined) return related;
    }
    return undefined;
  }

  // Brings back a channel favorite: weighted by how much the channel let it
  // play, so the best-loved come back most without the list going stale.
  async #pickClassic(context: AutoplayContext): Promise<Track | undefined> {
    const recentCount = (artist: string | undefined): number =>
      artist === undefined
        ? 0
        : context.recentArtists.filter(
            (recent) => recent.toLowerCase() === artist.toLowerCase(),
          ).length;
    const pool = (
      this.#autoplayProfile?.classicSeeds?.(AUTOPLAY_CLASSIC_POOL) ?? []
    ).filter(
      (seed) => !context.recentIds.has(seed.id) && recentCount(seed.artist) < 2,
    );
    const remaining = [...pool];
    for (let attempt = 0; attempt < AUTOPLAY_CLASSIC_ATTEMPTS; attempt++) {
      const seed = weightedPick(
        remaining,
        (entry) => entry.score,
        this.#autoplayRandom,
      );
      if (seed === undefined) return undefined;
      remaining.splice(remaining.indexOf(seed), 1);
      // Re-read metadata: the video may be gone, and the duration decides
      // loudness handling (a track without one is treated as live radio).
      const metadata = await this.#resolver
        .getTrack({ id: seed.id, type: "video" })
        .catch(() => undefined);
      if (metadata === undefined) continue;
      return this.#autoplayTrack(metadata);
    }
    return undefined;
  }

  // Something new for the channel: a mix seeded by one of the artists the
  // channel plays most, keeping only tracks it has never heard.
  async #pickDiscovery(context: AutoplayContext): Promise<Track | undefined> {
    const hasHeard = (id: string): boolean =>
      this.#autoplayProfile?.hasHeard?.(id) ?? false;
    const artists = [
      ...(this.#autoplayProfile?.channelArtistSeeds?.(
        AUTOPLAY_DISCOVER_ARTISTS,
      ) ?? []),
    ];
    const channelProfile: AutoplayProfile = {
      artistScores:
        this.#autoplayProfile?.artistScores() ?? new Map<string, number>(),
      tokenScores: new Map<string, number>(),
    };
    for (let attempt = 0; attempt < AUTOPLAY_DISCOVER_ATTEMPTS; attempt++) {
      const seed = weightedPick(
        artists,
        (entry) => artists.length - artists.indexOf(entry),
        this.#autoplayRandom,
      );
      if (seed === undefined) return undefined;
      artists.splice(artists.indexOf(seed), 1);
      const candidates = (await this.#mixCandidates(seed.id)).filter(
        (candidate) => !hasHeard(candidate.id),
      );
      const pick = pickAutoplayTrack(
        candidates,
        channelProfile,
        context.recentIds,
        context.recentArtists,
        context.lastTrack,
        this.#autoplayRandom,
      );
      if (pick !== undefined) return this.#autoplayTrack(pick);
    }
    return undefined;
  }

  async #mixCandidates(
    seedVideoId: string,
  ): Promise<readonly AutoplayCandidate[]> {
    const cached = this.#mixCache.get(seedVideoId);
    if (
      cached !== undefined &&
      Date.now() - cached.at < AUTOPLAY_MIX_CACHE_TTL_MS
    ) {
      return cached.candidates;
    }
    const expansion = await this.#resolver.expandPlaylist(
      { id: `RD${seedVideoId}`, type: "playlist" },
      AUTOPLAY_MIX_LIMIT,
    );
    const candidates: AutoplayCandidate[] = [];
    for (const entry of expansion.tracks) {
      if (!entry.id || !entry.title || !entry.webpageUrl) continue;
      const { artist } = parseArtistTitle(entry.title);
      candidates.push({
        ...(artist === undefined ? {} : { artist }),
        ...(entry.durationSeconds === undefined
          ? {}
          : { durationSeconds: entry.durationSeconds }),
        id: entry.id,
        source: entry.webpageUrl,
        title: entry.title,
      });
    }
    this.#mixCache.delete(seedVideoId);
    this.#mixCache.set(seedVideoId, { at: Date.now(), candidates });
    if (this.#mixCache.size > AUTOPLAY_MIX_CACHE_MAX) {
      const oldest = this.#mixCache.keys().next().value;
      if (oldest !== undefined) this.#mixCache.delete(oldest);
    }
    return candidates;
  }

  #autoplayTrack(pick: {
    readonly durationSeconds?: number;
    readonly id: string;
    readonly source?: string;
    readonly title: string;
    readonly webpageUrl?: string;
  }): Track {
    return {
      ...(pick.durationSeconds === undefined
        ? {}
        : { durationSeconds: pick.durationSeconds }),
      id: pick.id,
      requestedBy: AUTOPLAY_REQUESTER,
      requestedByUid: AUTOPLAY_UID,
      source: pick.source ?? pick.webpageUrl ?? youtubeWatchUrl(pick.id),
      title: pick.title,
    };
  }

  #resolveAutoplayUid(history: readonly Track[]): string | undefined {
    for (const track of history) {
      if (
        track.requestedByUid !== undefined &&
        track.requestedByUid !== AUTOPLAY_UID
      ) {
        return track.requestedByUid;
      }
    }
    return this.#autoplayUid;
  }

  async #expandAutoplayMix(
    seedVideoId: string,
    recentIds: ReadonlySet<string>,
    recentArtists: readonly string[],
    profile: AutoplayProfile,
    lastTrack: LastPlayedTrack | undefined,
  ): Promise<Track | undefined> {
    const pick = pickAutoplayTrack(
      await this.#mixCandidates(seedVideoId),
      profile,
      recentIds,
      recentArtists,
      lastTrack,
      this.#autoplayRandom,
    );
    return pick === undefined ? undefined : this.#autoplayTrack(pick);
  }

  async #resolveRelatedVideo(
    seedVideoId: string,
    recentIds: ReadonlySet<string>,
    recentArtists: readonly string[],
  ): Promise<Track | undefined> {
    const videoId = await this.#relatedVideoId(seedVideoId);
    if (videoId === undefined || recentIds.has(videoId)) return undefined;
    const metadata = await this.#resolver.getTrackFromUrl(
      `https://www.youtube.com/watch?v=${videoId}`,
    );
    const artist = parseArtistTitle(metadata.title).artist;
    if (
      artist !== undefined &&
      recentArtists.filter(
        (recent) => recent.toLowerCase() === artist.toLowerCase(),
      ).length >= 2
    ) {
      return undefined;
    }
    return {
      ...(metadata.durationSeconds === undefined
        ? {}
        : { durationSeconds: metadata.durationSeconds }),
      id: metadata.id,
      requestedBy: AUTOPLAY_REQUESTER,
      requestedByUid: AUTOPLAY_UID,
      source: metadata.webpageUrl,
      title: metadata.title,
    };
  }

  stop(persistState = true): void {
    this.#persistenceSuppressed = !persistState;
    this.#controller.stop();
    this.#queue.clear();
    this.#preparedStore.invalidateAll();
    if (persistState) this.#persistState();
  }

  seek(seconds: number): void {
    this.#controller.seek(seconds);
  }

  replayPrevious(): Track {
    return this.#controller.replayPrevious();
  }

  pause(): void {
    this.#controller.pause();
  }

  resume(): void {
    this.#controller.resume();
  }

  removeQueued(position: number): Track | undefined {
    const removed = this.#queue.removeAt(position);
    if (removed) this.#preparedStore.invalidate(removed.source);
    if (removed) this.#persistState();
    return removed;
  }

  clearQueued(): number {
    const count = this.#queue.length;
    this.#controller.resetQueueState();
    this.#queue.clear();
    this.#preparedStore.invalidateAll();
    this.#persistState();
    return count;
  }

  shuffleQueued(): number {
    const count = this.#queue.length;
    this.#queue.shuffle();
    this.#persistState();
    return count;
  }

  #persistState(): void {
    if (this.#persistenceSuppressed) return;
    this.#safeObserver(() => {
      this.#stateStore?.save({
        ...(this.#controller.autoplayEnabled ? { autoplay: true } : {}),
        loopMode: this.#controller.loopMode,
        queue: this.#serializedQueue(),
        volumePercent: this.#controller.volume,
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
    if (this.#controller.current) include(this.#controller.current);
    for (const track of this.#queue.snapshot()) include(track);
    return entries;
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

  #recordMetadataTiming(
    metadata: YoutubeTrackMetadata,
    startedAt: number,
  ): void {
    this.#requestedAt.set(metadata.id, startedAt);
    if (this.#requestedAt.size > MAX_PENDING_REQUESTS) {
      const oldest = this.#requestedAt.keys().next().value;
      if (oldest !== undefined) this.#requestedAt.delete(oldest);
    }
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
