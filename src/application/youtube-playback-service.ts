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

export interface PlaybackServiceOptions {
  readonly encoder: RhapsodOpusEncoder;
  readonly resolver: YoutubePlaybackResolver;
  readonly output: VoiceFrameOutput;
  readonly createPlayback?: typeof playFfmpegUrl;
  readonly onPlaybackError?: (
    track: Track,
    error: Error,
  ) => void | Promise<void>;
}

export interface YoutubePlaybackResolver {
  getAudioUrl(resource: YoutubeResource): Promise<string>;
  getTrack(resource: YoutubeResource): Promise<YoutubeTrackMetadata>;
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
  #current: Track | undefined;
  #session: FfmpegPlaybackSession | undefined;
  #generation = 0;

  constructor(options: PlaybackServiceOptions) {
    this.#encoder = options.encoder;
    this.#resolver = options.resolver;
    this.#output = options.output;
    this.#createPlayback = options.createPlayback ?? playFfmpegUrl;
    this.#onPlaybackError = options.onPlaybackError ?? (() => undefined);
  }

  get current(): Track | undefined {
    return this.#current;
  }

  queue(): readonly Track[] {
    return this.#queue.snapshot();
  }

  async enqueue(input: string, requestedBy: string): Promise<Track> {
    const media = parseMediaInput(input);
    if (media.kind !== "youtube" || media.resource.type !== "video") {
      throw new Error(
        "Only YouTube video links are supported for playback yet",
      );
    }
    const metadata = await this.#resolver.getTrack(media.resource);
    const track: Track = {
      id: metadata.id,
      requestedBy,
      source: metadata.webpageUrl,
      title: metadata.title,
    };
    this.#queue.add(track);
    if (!this.#current) void this.#playNext();
    return track;
  }

  skip(): void {
    this.#session?.stop();
    this.#session = undefined;
    this.#current = undefined;
    void this.#playNext();
  }

  stop(): void {
    this.#generation++;
    this.#session?.stop();
    this.#session = undefined;
    this.#current = undefined;
    this.#queue.clear();
  }

  #playNext(): Promise<void> {
    const track = this.#queue.next();
    if (!track) {
      this.#current = undefined;
      return Promise.resolve();
    }
    const generation = ++this.#generation;
    this.#current = track;
    return this.#resolver
      .getAudioUrl({ id: track.id, type: "video" })
      .then((url) => {
        if (generation !== this.#generation || this.#current !== track) return;
        const session = this.#createPlayback(url, this.#encoder, this.#output);
        this.#session = session;
        return session.done;
      })
      .catch(async (error: unknown) => {
        const playbackError =
          error instanceof Error ? error : new Error(String(error));
        await this.#onPlaybackError(track, playbackError);
      })
      .then(() => {
        if (generation !== this.#generation || this.#current !== track) return;
        this.#session = undefined;
        this.#current = undefined;
        return this.#playNext();
      });
  }
}
