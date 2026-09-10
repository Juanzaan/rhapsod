import { parseMediaInput } from "../media/media-input.js";
import type { RedirectResolver } from "../media/redirect-resolver.js";
import type {
  PlaylistExpansion,
  YoutubeTrackMetadata,
} from "../media/youtube/yt-dlp.js";
import type { YoutubeResource } from "../media/media-input.js";
import type { Track } from "../domain/track.js";
import { QueueLimitError, TrackQueue } from "./track-queue.js";
import type { createPcmStream, playFfmpegUrl } from "../audio/ffmpeg-player.js";
import type { LoudnessProfiler } from "../audio/loudness-profiler.js";
import type { RhapsodOpusEncoder } from "../audio/opus-encoder.js";
import type { VoiceFrameOutput } from "../audio/audio-player.js";
import type { AudioFilter, FilterParam } from "../audio/filter-chain.js";
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
import { parseMusicQuery } from "../lib/query-parser.js";
import { UserError } from "../lib/user-error.js";
import { PreparedAudioStore } from "./prepared-audio-store.js";
import {
  PlaybackController,
  type LoopMode,
  type PlaybackDriverState,
  type PlaybackEndReason,
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

// Kept here so existing importers (tests) keep working; the implementation
// lives with the store that uses it.
export { audioUrlExpiresAt } from "./prepared-audio-store.js";

export class YoutubePlaybackService {
  readonly #queue: TrackQueue;
  readonly #controller: PlaybackController;
  readonly #resolver: YoutubePlaybackResolver;
  readonly #alternativeResolver: AlternativeSourceResolver | undefined;
  readonly #directUrlResolver: DirectUrlResolver | undefined;
  readonly #soundcloudResolver: SoundCloudResolver | undefined;
  readonly #spotifyResolver: SpotifyResolver | undefined;
  readonly #lyricsResolver: LyricsResolver | undefined;
  readonly #stateStore: PlaybackStateStore | undefined;
  readonly #onTiming: (timing: PlaybackTiming) => void;
  readonly #redirectResolver: RedirectResolver | undefined;
  readonly #playlistStore: PlaylistStore | undefined;
  readonly #playlistMaxTracks: number;
  #expansionActive = false;
  #persistenceSuppressed = false;
  readonly #preparedStore: PreparedAudioStore;

  constructor(options: PlaybackServiceOptions) {
    this.#resolver = options.resolver;
    this.#alternativeResolver = options.alternativeResolver;
    this.#directUrlResolver = options.directUrlResolver;
    this.#soundcloudResolver = options.soundcloudResolver;
    this.#spotifyResolver = options.spotifyResolver;
    this.#lyricsResolver = options.lyricsResolver;
    this.#stateStore = options.stateStore;
    this.#onTiming = options.onTiming ?? (() => undefined);
    this.#preparedStore = new PreparedAudioStore({
      ...(options.audioUrlCache === undefined
        ? {}
        : { cache: options.audioUrlCache }),
    });
    this.#redirectResolver = options.redirectResolver;
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
      ...(restored?.filter === undefined
        ? {}
        : { initialFilter: restored.filter }),
      ...(restored?.loopMode === undefined
        ? {}
        : { initialLoopMode: restored.loopMode }),
      ...(restored?.volumePercent === undefined
        ? {}
        : { initialVolumePercent: restored.volumePercent }),
      ...(options.loudnessProfiler === undefined
        ? {}
        : { loudnessProfiler: options.loudnessProfiler }),
      ...(options.onPlaybackError === undefined
        ? {}
        : { onPlaybackError: options.onPlaybackError }),
      ...(options.onPlaybackFinished === undefined
        ? {}
        : { onPlaybackFinished: options.onPlaybackFinished }),
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

  get filter(): AudioFilter {
    return this.#controller.filter;
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

  setFilter(filter: AudioFilter, param?: FilterParam): void {
    this.#controller.setFilter(filter, param);
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
        "No encontré esa búsqueda en SoundCloud. Probá con !yt para buscar en YouTube.",
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
      throw new UserError(
        "Solo se pueden expandir playlists de YouTube con !play.",
      );
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
        throw new UserError(
          "Este bot no tiene resolución de links de Apple Music o Amazon Music configurada.",
        );
      }
      const alternative =
        await this.#alternativeResolver.findAlternative(input);
      if (!this.#controller.isStopEpochCurrent(stopEpoch)) {
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
      const stopEpoch = this.#controller.captureStopEpoch();
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
    if (metadata.audioUrl)
      this.#preparedStore.setReady(track, metadata.audioUrl);
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
    const filter = this.#controller.filter;
    this.#safeObserver(() => {
      this.#stateStore?.save({
        loopMode: this.#controller.loopMode,
        ...(filter === "off" ? {} : { filter }),
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
