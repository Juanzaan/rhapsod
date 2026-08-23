import type { MinimalLogger } from "../../observability/logger.js";
import { noopLogger } from "../../observability/logger.js";
import { parseMediaInput } from "../media-input.js";
import type { YoutubeResource } from "../media-input.js";
import type { PlaylistExpansion, YoutubeTrackMetadata } from "./yt-dlp.js";
import type { YoutubePlaybackResolver } from "./youtube-resolver.js";
import type { YoutubeiResolver } from "./youtubei-resolver.js";

export class YoutubeResolverWithFallback implements YoutubePlaybackResolver {
  readonly name = "youtube-with-fallback";

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
    if (videoId !== undefined && this.primary !== undefined) {
      if (signal?.aborted) {
        this.logger.debug("youtubei.js skipped: request already aborted");
      } else {
        try {
          return await this.primary.getAudioUrl(videoId);
        } catch (error) {
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

  async #tryPrimary<T>(
    operation: string,
    run: () => Promise<T> | undefined,
  ): Promise<T | undefined> {
    if (this.primary === undefined) return undefined;
    try {
      return await run();
    } catch (error) {
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
