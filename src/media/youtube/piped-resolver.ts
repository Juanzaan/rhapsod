import type { MinimalLogger } from "../../observability/logger.js";
import { noopLogger } from "../../observability/logger.js";
import type { YoutubeResource } from "../media-input.js";
import { parseMediaInput } from "../media-input.js";
import type { PlaylistExpansion, YoutubeTrackMetadata } from "./yt-dlp.js";
import type { PipedClient } from "./piped-client.js";
import type { YoutubePlaybackResolver } from "./youtube-resolver.js";

export class PipedResolver implements YoutubePlaybackResolver {
  readonly name = "piped";

  constructor(
    private readonly client: PipedClient,
    private readonly fallback: YoutubePlaybackResolver,
    private readonly logger: MinimalLogger = noopLogger,
  ) {}

  async getTrack(resource: YoutubeResource): Promise<YoutubeTrackMetadata> {
    if (resource.type === "video") {
      try {
        const [audioUrl, title] = await Promise.all([
          this.client.getStreamUrl(resource.id),
          this.client.getVideoTitle(resource.id),
        ]);
        return {
          audioUrl,
          id: resource.id,
          title,
          webpageUrl: `https://www.youtube.com/watch?v=${resource.id}`,
        };
      } catch (error) {
        this.logger.warn(
          { err: error, videoId: resource.id },
          "Piped failed for getTrack; falling back",
        );
      }
    }
    return this.fallback.getTrack(resource);
  }

  async getTrackFromUrl(url: string): Promise<YoutubeTrackMetadata> {
    const videoId = youtubeVideoId(url);
    if (videoId !== undefined) {
      try {
        const [audioUrl, title] = await Promise.all([
          this.client.getStreamUrl(videoId),
          this.client.getVideoTitle(videoId),
        ]);
        return {
          audioUrl,
          id: videoId,
          title,
          webpageUrl: `https://www.youtube.com/watch?v=${videoId}`,
        };
      } catch (error) {
        this.logger.warn(
          { err: error, videoId },
          "Piped failed for getTrackFromUrl; falling back",
        );
      }
    }
    return this.fallback.getTrackFromUrl(url);
  }

  async getAudioUrlFromUrl(url: string, signal?: AbortSignal): Promise<string> {
    if (signal?.aborted) {
      throw new Error("Request already aborted");
    }
    const videoId = youtubeVideoId(url);
    if (videoId !== undefined) {
      try {
        return await this.client.getStreamUrl(videoId);
      } catch (error) {
        this.logger.warn(
          { err: error, videoId },
          "Piped failed for getAudioUrl; falling back",
        );
      }
    }
    return this.fallback.getAudioUrlFromUrl(url, signal);
  }

  async search(
    query: string,
    expectedDurationSeconds?: number,
    expectedTitle?: string,
  ): Promise<YoutubeTrackMetadata> {
    try {
      const results = await this.client.search(query, 10);
      if (results.length > 0) {
        const best = results[0]!;
        const videoId = this.#extractVideoId(best.url);
        if (videoId !== undefined) {
          const audioUrl = await this.client.getStreamUrl(videoId);
          return {
            audioUrl,
            id: videoId,
            title: best.title,
            webpageUrl: `https://www.youtube.com/watch?v=${videoId}`,
          };
        }
      }
    } catch (error) {
      this.logger.warn(
        { err: error, query },
        "Piped search failed; falling back",
      );
    }
    return this.fallback.search(query, expectedDurationSeconds, expectedTitle);
  }

  async searchMany(
    query: string,
    expectedDurationSeconds?: number,
    limit?: number,
  ): Promise<readonly YoutubeTrackMetadata[]> {
    try {
      const results = await this.client.search(query, limit ?? 10);
      const tracks: YoutubeTrackMetadata[] = [];
      for (const result of results) {
        const videoId = this.#extractVideoId(result.url);
        if (videoId !== undefined) {
          tracks.push({
            id: videoId,
            title: result.title,
            webpageUrl: `https://www.youtube.com/watch?v=${videoId}`,
          });
        }
      }
      if (tracks.length > 0) return tracks;
    } catch (error) {
      this.logger.warn(
        { err: error, query },
        "Piped searchMany failed; falling back",
      );
    }
    return this.fallback.searchMany(query, expectedDurationSeconds, limit);
  }

  expandPlaylist(
    resource: YoutubeResource,
    limit: number,
  ): Promise<PlaylistExpansion> {
    return this.fallback.expandPlaylist(resource, limit);
  }

  #extractVideoId(url: string): string | undefined {
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
