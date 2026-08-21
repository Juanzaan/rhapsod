import type { Innertube } from "youtubei.js";

import type { PoTokenProvider } from "./http-po-token-provider.js";
import type { YoutubeTrackMetadata } from "./yt-dlp.js";

type VideoInfo = Awaited<ReturnType<Innertube["getBasicInfo"]>>;

export class YoutubeiResolver {
  readonly name = "youtubei";

  constructor(
    private readonly youtube: Innertube,
    private readonly poTokens?: PoTokenProvider,
  ) {}

  async getTrack(videoId: string): Promise<YoutubeTrackMetadata> {
    const info = await this.#getVideoInfo(videoId);
    const audioUrl = await this.#resolveAudioUrl(info);
    const basic = info.basic_info;

    return {
      audioUrl,
      ...(basic.duration === undefined
        ? {}
        : { durationSeconds: basic.duration }),
      id: basic.id ?? videoId,
      title: basic.title ?? videoId,
      webpageUrl: `https://www.youtube.com/watch?v=${videoId}`,
    };
  }

  async getAudioUrl(videoId: string): Promise<string> {
    const info = await this.#getVideoInfo(videoId);
    return this.#resolveAudioUrl(info);
  }

  async #getVideoInfo(videoId: string): Promise<VideoInfo> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = this.poTokens
        ? await this.poTokens.get(videoId)
        : undefined;
      try {
        const info = await this.youtube.getBasicInfo(videoId, {
          ...(token === undefined ? {} : { po_token: token }),
        });
        if (!info.streaming_data) {
          throw new Error(
            `youtubei.js returned no streaming data: ${info.playability_status?.status ?? "unknown"}`,
          );
        }
        return info;
      } catch (error) {
        if (
          this.poTokens === undefined ||
          attempt > 0 ||
          !isPotFailure(error)
        ) {
          throw error;
        }
        this.poTokens.invalidate(videoId);
      }
    }
    throw new Error("youtubei.js failed after POT refresh");
  }

  async #resolveAudioUrl(info: VideoInfo): Promise<string> {
    const format = info.chooseFormat({ type: "audio", quality: "best" });
    if (!format) {
      throw new Error("youtubei.js returned no playable audio format");
    }
    const url = await format.decipher(this.youtube.session.player);
    if (!url || !url.startsWith("https://")) {
      throw new Error("youtubei.js returned an invalid audio URL");
    }
    return url;
  }
}

function isPotFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /login_required|not a bot|streaming data not available|403|400/i.test(
    message,
  );
}
