import type { MinimalLogger } from "../../observability/logger.js";
import { noopLogger } from "../../observability/logger.js";
import { parseMediaInput } from "../media-input.js";
import type { YoutubeResource } from "../media-input.js";
import type { PlaylistExpansion, YoutubeTrackMetadata } from "./yt-dlp.js";
import type { YoutubePlaybackResolver } from "./youtube-resolver.js";
import type { YoutubeiResolver } from "./youtubei-resolver.js";

const YOUTUBEI_CIRCUIT_BREAKER_THRESHOLD = 3;
const YOUTUBEI_CIRCUIT_COOLDOWN_MS = 5 * 60_000;

export class YoutubeResolverWithFallback implements YoutubePlaybackResolver {
  readonly name = "youtube-with-fallback";
  #primaryConsecutiveFailures = 0;
  #circuitOpenUntil = 0;

  constructor(
    private readonly primary: YoutubeiResolver | undefined,
    private readonly fallback: YoutubePlaybackResolver,
    private readonly logger: MinimalLogger = noopLogger,
  ) {}

  async getTrack(resource: YoutubeResource): Promise<YoutubeTrackMetadata> {
    if (resource.type === "video") {
      const primaryResult = await this.#tryPrimary("getTrack", () =>
        this.primary?.getTrack(resource.id),
      );
      if (primaryResult !== undefined) return primaryResult;
    }
    return this.fallback.getTrack(resource);
  }

  getTrackFromUrl(url: string): Promise<YoutubeTrackMetadata> {
    const videoId = youtubeVideoId(url);
    if (videoId !== undefined) {
      return this.#tryPrimary("getTrackFromUrl", () =>
        this.primary?.getTrack(videoId),
      ).then((primaryResult) =>
        primaryResult === undefined
          ? this.fallback.getTrackFromUrl(url)
          : primaryResult,
      );
    }
    return this.fallback.getTrackFromUrl(url);
  }

  async getAudioUrlFromUrl(url: string, signal?: AbortSignal): Promise<string> {
    const videoId = youtubeVideoId(url);
    if (videoId !== undefined && this.#primaryAvailable()) {
      if (signal?.aborted) {
        this.logger.debug("youtubei.js skipped: request already aborted");
      } else {
        try {
          const result = await this.primary!.getAudioUrl(videoId);
          this.#recordPrimarySuccess();
          return result;
        } catch (error) {
          this.#recordPrimaryFailure();
          this.logger.warn(
            { err: error },
            "youtubei.js failed; falling back to yt-dlp",
          );
        }
      }
    }
    return this.fallback.getAudioUrlFromUrl(url, signal);
  }

  search(
    query: string,
    expectedDurationSeconds?: number,
    expectedTitle?: string,
  ): Promise<YoutubeTrackMetadata> {
    return this.fallback.search(query, expectedDurationSeconds, expectedTitle);
  }

  searchMany(
    query: string,
    expectedDurationSeconds?: number,
    limit?: number,
  ): Promise<readonly YoutubeTrackMetadata[]> {
    return this.fallback.searchMany(query, expectedDurationSeconds, limit);
  }

  expandPlaylist(
    resource: YoutubeResource,
    limit: number,
  ): Promise<PlaylistExpansion> {
    return this.fallback.expandPlaylist(resource, limit);
  }

  #primaryAvailable(): boolean {
    return this.primary !== undefined && Date.now() >= this.#circuitOpenUntil;
  }

  #recordPrimarySuccess(): void {
    this.#primaryConsecutiveFailures = 0;
    this.#circuitOpenUntil = 0;
  }

  #recordPrimaryFailure(): void {
    this.#primaryConsecutiveFailures += 1;
    if (
      this.#primaryConsecutiveFailures >= YOUTUBEI_CIRCUIT_BREAKER_THRESHOLD
    ) {
      this.#circuitOpenUntil = Date.now() + YOUTUBEI_CIRCUIT_COOLDOWN_MS;
      this.#primaryConsecutiveFailures = 0;
      this.logger.warn(
        "youtubei.js circuit breaker opened; using yt-dlp only for a cooldown",
      );
    }
  }

  async #tryPrimary<T>(
    operation: string,
    run: () => Promise<T> | undefined,
  ): Promise<T | undefined> {
    if (!this.#primaryAvailable()) return undefined;
    try {
      const result = await run();
      this.#recordPrimarySuccess();
      return result;
    } catch (error) {
      this.#recordPrimaryFailure();
      this.logger.warn(
        { operation, err: error },
        "youtubei.js failed; falling back to yt-dlp",
      );
      return undefined;
    }
  }
}

function youtubeVideoId(url: string): string | undefined {
  try {
    const media = parseMediaInput(url);
    if (media.kind === "youtube" && media.resource.type === "video") {
      return media.resource.id;
    }
  } catch {
    return undefined;
  }
  return undefined;
}
