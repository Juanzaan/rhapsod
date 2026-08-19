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
import {
  parseArtistTitle,
  type LyricsResolver,
  type TrackLyrics,
} from "../media/lyrics.js";

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
  readonly output: VoiceFrameOutput;
  readonly playlistMaxTracks?: number;
  readonly maxQueueTracks?: number;
  readonly maxTracksPerUser?: number;
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
  searchMany(
    query: string,
    expectedDurationSeconds?: number,
    limit?: number,
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
const DEFAULT_PLAYLIST_MAX_TRACKS = 20;
const DEFAULT_MAX_QUEUE_TRACKS = 200;
const DEFAULT_MAX_TRACKS_PER_USER = 30;
const HISTORY_LIMIT = 20;

class QueueLimitError extends Error {}

interface PreparedAudio {
  readonly url: string;
  readonly expiresAt: number;
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
  readonly #maxQueueTracks: number;
  readonly #maxTracksPerUser: number;
  #expansionActive = false;
  #current: Track | undefined;
  #session: FfmpegPlaybackSession | undefined;
  #generation = 0;
  #chainActive = false;
  #pendingSeek: number | undefined;
  #pendingSkips = 0;
  #volumePercent = 50;
  #tracksPlayed = 0;
  readonly #history: Track[] = [];
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
    this.#directUrlResolver = options.directUrlResolver;
    this.#soundcloudResolver = options.soundcloudResolver;
    this.#spotifyResolver = options.spotifyResolver;
    this.#lyricsResolver = options.lyricsResolver;
    this.#stateStore = options.stateStore;
    this.#output = options.output;
    this.#createPlayback = options.createPlayback ?? playFfmpegUrl;
    this.#onPlaybackError = options.onPlaybackError ?? (() => undefined);
    this.#onPlaybackStarted = options.onPlaybackStarted ?? (() => undefined);
    this.#onPlaybackFinished = options.onPlaybackFinished ?? (() => undefined);
    this.#onTiming = options.onTiming ?? (() => undefined);
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

  setLoopMode(mode: LoopMode): void {
    this.#loopMode = mode;
    this.#loopPool = mode === "queue" ? [...this.#queue.snapshot()] : [];
    this.#persistState();
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
      if (
        !this.#directUrlResolver ||
        !(await this.#directUrlResolver.match(media.value))
      ) {
        throw new Error(
          "No reconozco ese link: pegá un link de YouTube o SoundCloud, una URL de audio directa (mp3, ogg, m3u8…), o buscá con !yt.",
        );
      }
      const metadata = await this.#directUrlResolver.getTrack(media.value);
      this.#recordMetadataTiming(metadata, startedAt);
      return this.#enqueueMetadata(metadata, requestedBy, "direct-url");
    }
    if (media.kind === "soundcloud") {
      if (/\/sets\//i.test(media.value)) {
        const result = await this.enqueueMusicLink(media.value, requestedBy);
        const first = result.added[0];
        if (!first) {
          throw new Error(
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
            if (
              alternative.provider === "soundcloud" &&
              this.#soundcloudResolver
            ) {
              const metadata = await this.#soundcloudResolver.getTrack(
                alternative.url,
              );
              this.#recordMetadataTiming(metadata, startedAt);
              return this.#enqueueMetadata(metadata, requestedBy);
            }
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
    if (media.kind === "apple-music" || media.kind === "amazon-music") {
      const result = await this.enqueueMusicLink(media.value, requestedBy);
      const first = result.added[0];
      if (!first) {
        throw new Error(
          "No pude encontrar esa canción en YouTube o SoundCloud.",
        );
      }
      return first;
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

  async enqueueSearchIndex(
    query: string,
    index: number,
    requestedBy: string,
  ): Promise<Track> {
    const startedAt = Date.now();
    const candidates = await this.#resolver.searchMany(query, undefined, 5);
    const selected = candidates[index - 1];
    if (!selected) {
      throw new Error(`No hay resultado ${index} para esa búsqueda.`);
    }
    this.#recordMetadataTiming(selected, startedAt);
    return this.#enqueueMetadata(selected, requestedBy);
  }

  async enqueueNext(input: string, requestedBy: string): Promise<Track> {
    const media = parseMediaInput(input);
    if (media.kind === "youtube" && media.resource.type === "playlist") {
      throw new Error("Las playlists se encolan con !play, no con !playnext.");
    }
    const track = await this.enqueue(input, requestedBy);
    this.#queue.moveToHead(track.id);
    if (this.#current) this.#prefetchNext();
    this.#persistState();
    return track;
  }

  restoreQueuedTracks(connectedUids: readonly string[]): number {
    const connected = new Set(connectedUids);
    let restored = 0;
    for (const entry of this.#persistedQueue) {
      if (!connected.has(entry.requestedBy)) continue;
      if (this.#queue.length >= this.#maxQueueTracks) break;
      try {
        this.#queue.add({
          ...(entry.durationSeconds === undefined
            ? {}
            : { durationSeconds: entry.durationSeconds }),
          id: entry.id,
          requestedBy: entry.requestedBy,
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
      this.#requestNext();
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
    for (const track of removed) this.#prepared.delete(track.source);
    this.#persistState();
    return removed;
  }

  history(): readonly Track[] {
    return [...this.#history];
  }

  async getLyrics(): Promise<TrackLyrics | undefined> {
    if (!this.#lyricsResolver || !this.#current) return undefined;
    const parsed = parseArtistTitle(this.#current.title);
    return this.#lyricsResolver.search(parsed.artist, parsed.title);
  }

  async enqueuePlaylist(
    resource: YoutubeResource,
    requestedBy: string,
  ): Promise<PlaylistEnqueueResult> {
    if (resource.type !== "playlist")
      throw new Error("Only YouTube playlists can be expanded");
    return this.#withExpansionSlot(async () => {
      const expansion = await this.#resolver.expandPlaylist(
        resource,
        this.#playlistMaxTracks,
      );
      return this.#enqueuePlaylistExpansion(expansion, requestedBy);
    });
  }

  async enqueueMusicLink(
    input: string,
    requestedBy: string,
  ): Promise<PlaylistEnqueueResult> {
    return this.#withExpansionSlot(async () => {
      if (!this.#alternativeResolver) {
        throw new Error(
          "Este bot no tiene resolución de links de Apple Music o Amazon Music configurada.",
        );
      }
      const alternative =
        await this.#alternativeResolver.findAlternative(input);
      if (!alternative) {
        throw new Error(
          "No pude encontrar ese link en YouTube o SoundCloud. Probá pegando el link directo de YouTube.",
        );
      }
      if (alternative.provider === "soundcloud") {
        if (!this.#soundcloudResolver) {
          throw new Error(
            "El link solo existe en SoundCloud, pero ese proveedor no está configurado.",
          );
        }
        const metadata = await this.#soundcloudResolver.getTrack(
          alternative.url,
        );
        this.#recordMetadataTiming(metadata, Date.now());
        return { added: [this.#enqueueMetadata(metadata, requestedBy)] };
      }
      const parsed = parseMediaInput(alternative.url);
      if (parsed.kind === "youtube" && parsed.resource.type === "playlist") {
        const expansion = await this.#resolver.expandPlaylist(
          parsed.resource,
          this.#playlistMaxTracks,
        );
        return this.#enqueuePlaylistExpansion(expansion, requestedBy);
      }
      if (parsed.kind === "youtube" && parsed.resource.type === "video") {
        const metadata = await this.#resolver.getTrack(parsed.resource);
        this.#recordMetadataTiming(metadata, Date.now());
        return { added: [this.#enqueueMetadata(metadata, requestedBy)] };
      }
      if (parsed.kind === "soundcloud" && this.#soundcloudResolver) {
        const metadata = await this.#soundcloudResolver.getTrack(parsed.value);
        this.#recordMetadataTiming(metadata, Date.now());
        return { added: [this.#enqueueMetadata(metadata, requestedBy)] };
      }
      throw new Error(
        "El link alternativo no apunta a una fuente reproducible.",
      );
    });
  }

  #enqueuePlaylistExpansion(
    expansion: PlaylistExpansion,
    requestedBy: string,
  ): PlaylistEnqueueResult {
    const added: Track[] = [];
    let duplicates = 0;
    let halted = false;
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
        if (error instanceof QueueLimitError) {
          halted = true;
          break;
        }
        if (error instanceof Error && /already queued/i.test(error.message)) {
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
      throw new Error(
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
  ): Promise<PlaylistEnqueueResult> {
    return this.#withExpansionSlot(async () => {
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
      let halted = false;
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
          if (error instanceof QueueLimitError) {
            halted = true;
            break;
          }
          if (error instanceof Error && /already queued/i.test(error.message)) {
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
    if (this.#queue.length >= this.#maxQueueTracks) {
      throw new QueueLimitError(
        `La cola está llena (máximo ${this.#maxQueueTracks} pistas).`,
      );
    }
    const requesterCount = this.#queue
      .snapshot()
      .filter((queued) => queued.requestedBy === requestedBy).length;
    if (requesterCount >= this.#maxTracksPerUser) {
      throw new QueueLimitError(
        `Límite de ${this.#maxTracksPerUser} pistas por usuario en la cola.`,
      );
    }
    if (metadata.audioUrl) this.#cacheAudioUrl(track, metadata.audioUrl);
    this.#queue.add(track);
    this.#requestNext();
    this.#persistState();
    if (this.#current) this.#prefetchNext();
    return track;
  }

  skip(): void {
    this.#generation++;
    this.#pendingSkips++;
    this.#pendingSeek = undefined;
    if (this.#current) this.#prepared.delete(this.#current.source);
    if (this.#session) this.#sessionEndReasons.set(this.#session, "skipped");
    this.#session?.stop();
    this.#session = undefined;
    this.#requestNext();
  }

  stop(): void {
    this.#generation++;
    this.#pendingSkips = 0;
    this.#pendingSeek = undefined;
    if (this.#session) this.#sessionEndReasons.set(this.#session, "stopped");
    this.#session?.stop();
    this.#session = undefined;
    this.#current = undefined;
    this.#queue.clear();
    this.#loopMode = "off";
    this.#loopPool = [];
    this.#prepared.clear();
    this.#persistState();
  }

  seek(seconds: number): void {
    if (!this.#current || !this.#session) {
      throw new Error("No hay nada reproduciéndose para saltar de posición.");
    }
    let target = Math.max(0, Math.floor(seconds));
    if (this.#current.durationSeconds !== undefined) {
      target = Math.min(target, Math.max(0, this.#current.durationSeconds - 1));
    }
    this.#pendingSeek = target;
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
      throw new Error("No hay ninguna canción anterior para repetir.");
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
    if (removed) this.#prepared.delete(removed.source);
    if (removed) this.#persistState();
    return removed;
  }

  clearQueued(): number {
    const count = this.#queue.length;
    this.#pendingSkips = 0;
    this.#pendingSeek = undefined;
    this.#queue.clear();
    this.#loopMode = "off";
    this.#loopPool = [];
    this.#prepared.clear();
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
    this.#stateStore?.save({
      loopMode: this.#loopMode,
      queue: this.#serializedQueue(),
      volumePercent: this.#volumePercent,
    });
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
          for (let i = 0; i < toDrop; i++) this.#queue.next();
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
        if (resolved === undefined) continue;
        this.#onTiming({
          cacheHit: resolved.cacheHit,
          durationMs: Date.now() - audioResolutionStartedAt,
          stage: "audio-url",
          trackId: track.id,
        });
        const seekSeconds = this.#pendingSeek;
        this.#pendingSeek = undefined;
        const session =
          seekSeconds === undefined
            ? this.#createPlayback(resolved.url, this.#encoder, this.#output)
            : this.#createPlayback(resolved.url, this.#encoder, this.#output, {
                seekSeconds,
              });
        session.player.setVolume(volumeToGain(this.#volumePercent));
        this.#session = session;
        this.#tracksPlayed++;
        this.#recordHistory(track);
        void Promise.resolve(this.#onPlaybackStarted(track)).catch(
          () => undefined,
        );
        this.#prefetchNext();
        let playbackError: unknown;
        try {
          await session.done;
        } catch (error) {
          playbackError = error;
        }
        this.#onPlaybackFinished(
          track,
          session.player.metrics,
          this.#sessionEndReasons.get(session) ??
            (playbackError !== undefined ? "error" : "completed"),
        );
        if (playbackError !== undefined) {
          await this.#reportPlaybackError(track, playbackError);
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
  ): Promise<{ cacheHit: boolean; url: string } | undefined> {
    try {
      const resolved = await this.#getAudioUrl(track);
      if (generation !== this.#generation || this.#current !== track) {
        this.#prepared.delete(track.source);
        return undefined;
      }
      return resolved;
    } catch (error) {
      if (generation !== this.#generation || this.#current !== track) {
        this.#prepared.delete(track.source);
        return undefined;
      }
      const playbackError =
        error instanceof Error ? error : new Error(String(error));
      await this.#reportPlaybackError(track, playbackError);
      this.#prepared.delete(track.source);
      return undefined;
    }
  }

  async #reportPlaybackError(track: Track, error: unknown): Promise<void> {
    const playbackError =
      error instanceof Error ? error : new Error(String(error));
    try {
      await this.#onPlaybackError(track, playbackError);
    } catch {
      // Observability callbacks must never break the playback chain.
    }
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
