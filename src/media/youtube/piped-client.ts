import type { MinimalLogger } from "../../observability/logger.js";
import { noopLogger } from "../../observability/logger.js";

const DEFAULT_TIMEOUT_MS = 3_000;

export interface PipedSearchResult {
  readonly url: string;
  readonly title: string;
  readonly duration: number;
  readonly uploaderName: string;
}

export interface PipedStreamResponse {
  readonly title: string;
  readonly duration: number;
  readonly videoStreams: readonly PipedAudioStream[];
}

export interface PipedAudioStream {
  readonly url: string;
  readonly codec: string;
  readonly bitrate: number;
  readonly format: string;
}

export class PipedClient {
  readonly #instances: readonly string[];
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #logger: MinimalLogger;

  constructor(
    instances: readonly string[],
    options?: {
      readonly fetch?: typeof fetch;
      readonly timeoutMs?: number;
      readonly logger?: MinimalLogger;
    },
  ) {
    this.#instances = instances;
    this.#fetch = options?.fetch ?? fetch;
    this.#timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#logger = options?.logger ?? noopLogger;
  }

  async search(
    query: string,
    limit = 10,
  ): Promise<readonly PipedSearchResult[]> {
    const results = await this.#requestWithFallback<
      readonly PipedSearchResult[]
    >(`/search?q=${encodeURIComponent(query)}&filter=videos`);
    return results.slice(0, limit);
  }

  async getStreamUrl(videoId: string): Promise<string> {
    const info = await this.#getStreamInfo(videoId);
    const audioStream = this.#pickBestAudioStream(info.videoStreams);
    if (!audioStream) {
      throw new Error("Piped: no audio stream found");
    }
    return audioStream.url;
  }

  async getVideoTitle(videoId: string): Promise<string> {
    const info = await this.#getStreamInfo(videoId);
    return info.title;
  }

  async #getStreamInfo(videoId: string): Promise<PipedStreamResponse> {
    return this.#requestWithFallback<PipedStreamResponse>(
      `/streams/${videoId}`,
    );
  }

  async #requestWithFallback<T>(path: string): Promise<T> {
    const errors: string[] = [];
    for (const instance of this.#instances) {
      try {
        const url = `${instance}${path}`;
        this.#logger.debug({ url }, "Piped: requesting");
        const response = await this.#fetch(url, {
          signal: AbortSignal.timeout(this.#timeoutMs),
        });
        if (!response.ok) {
          throw new Error(`Piped returned HTTP ${response.status}`);
        }
        const data = (await response.json()) as T;
        return data;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(msg);
        this.#logger.debug(
          { instance, err: error },
          "Piped: instance failed, trying next",
        );
      }
    }
    throw new Error(`All Piped instances failed: ${errors.join("; ")}`);
  }

  #pickBestAudioStream(
    streams: readonly PipedAudioStream[],
  ): PipedAudioStream | undefined {
    const audioStreams = streams.filter(
      (s) =>
        s.format === "AUDIO_OPUS" ||
        s.format === "AUDIO_VORBIS" ||
        s.codec.includes("opus") ||
        s.codec.includes("vorbis"),
    );
    if (audioStreams.length === 0) {
      const anyAudio = streams.filter((s) => s.format.startsWith("AUDIO_"));
      if (anyAudio.length === 0) return undefined;
      return anyAudio.reduce((best, current) =>
        current.bitrate > best.bitrate ? current : best,
      );
    }
    return audioStreams.reduce((best, current) =>
      current.bitrate > best.bitrate ? current : best,
    );
  }
}
