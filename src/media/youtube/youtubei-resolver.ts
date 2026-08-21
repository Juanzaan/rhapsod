import type { Innertube } from "youtubei.js";

import type { YoutubeTrackMetadata } from "./yt-dlp.js";

type VideoInfo = Awaited<ReturnType<Innertube["getBasicInfo"]>>;

export class YoutubeiResolver {
  readonly name = "youtubei";

  constructor(private readonly youtube: Innertube) {}

  async getTrack(videoId: string): Promise<YoutubeTrackMetadata> {
    const info = await this.youtube.getBasicInfo(videoId);
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
    const info = await this.youtube.getBasicInfo(videoId);
    return this.#resolveAudioUrl(info);
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
