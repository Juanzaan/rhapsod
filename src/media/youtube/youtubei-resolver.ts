import type { Innertube } from "youtubei.js";

import type { PoTokenProvider } from "./http-po-token-provider.js";
import type { YoutubeTrackMetadata } from "./yt-dlp.js";

type VideoInfo = Awaited<ReturnType<Innertube["getBasicInfo"]>>;

export class YoutubeiResolver {
  readonly name = "youtubei";
  #clientIndex = 0;

  constructor(
    private readonly clients: readonly Innertube[],
    private readonly poTokens?: PoTokenProvider,
  ) {}

  async getTrack(videoId: string): Promise<YoutubeTrackMetadata> {
    const { info, player } = await this.#getVideoInfo(videoId);
    const audioUrl = await this.#resolveAudioUrl(info, player);
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
    const { info, player } = await this.#getVideoInfo(videoId);
    return this.#resolveAudioUrl(info, player);
  }

  async #getVideoInfo(
    videoId: string,
  ): Promise<{ info: VideoInfo; player: Innertube["session"]["player"] }> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = this.poTokens
        ? await this.poTokens.get(videoId)
        : undefined;
      const lastError = new Error("All clients failed");
      for (let i = 0; i < this.clients.length; i++) {
        const idx = (this.#clientIndex + i) % this.clients.length;
        const client = this.clients[idx]!;
        try {
          const info = await client.getBasicInfo(videoId, {
            ...(token === undefined ? {} : { po_token: token }),
          });
          if (!info.streaming_data) {
            throw new Error(
              `youtubei.js returned no streaming data: ${info.playability_status?.status ?? "unknown"}`,
            );
          }
          this.#clientIndex = (idx + 1) % this.clients.length;
          return { info, player: client.session.player };
        } catch (error) {
          lastError.message =
            error instanceof Error ? error.message : String(error);
        }
      }
      if (
        this.poTokens === undefined ||
        attempt > 0 ||
        !isPotFailure(lastError)
      ) {
        throw lastError;
      }
      this.poTokens.invalidate(videoId);
    }
    throw new Error("youtubei.js failed after POT refresh");
  }

  async #resolveAudioUrl(
    info: VideoInfo,
    player: Innertube["session"]["player"],
  ): Promise<string> {
    const format = info.chooseFormat({ type: "audio", quality: "best" });
    if (!format) {
      throw new Error("youtubei.js returned no playable audio format");
    }
    const url = await format.decipher(player);
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
