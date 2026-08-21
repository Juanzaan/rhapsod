import { describe, expect, it, vi } from "vitest";

import type { Innertube } from "youtubei.js";

import { YoutubeiResolver } from "../src/media/youtube/youtubei-resolver.js";

type VideoInfo = Awaited<ReturnType<Innertube["getBasicInfo"]>>;

function fakeInfo(options: {
  readonly chooseFormat?: unknown;
  readonly duration?: number;
  readonly id?: string;
  readonly title?: string;
  readonly videoId: string;
}): VideoInfo {
  return {
    basic_info: {
      ...(options.duration === undefined ? {} : { duration: options.duration }),
      ...(options.id === undefined ? {} : { id: options.id }),
      ...(options.title === undefined ? {} : { title: options.title }),
    },
    streaming_data: {},
    chooseFormat: vi.fn(() => options.chooseFormat),
  } as unknown as VideoInfo;
}

function fakeYoutube(info: VideoInfo): Innertube {
  return {
    getBasicInfo: vi.fn(() => info),
    session: { player: {} },
  } as unknown as Innertube;
}

describe("YoutubeiResolver", () => {
  it("resolves a track with metadata and audio url", async () => {
    const format = {
      decipher: vi.fn(() => "https://media.example/audio"),
    };
    const info = fakeInfo({
      duration: 213,
      id: "abc123",
      title: "Never Gonna Give You Up",
      videoId: "abc123",
      chooseFormat: format,
    });
    const resolver = new YoutubeiResolver(fakeYoutube(info));

    await expect(resolver.getTrack("abc123")).resolves.toEqual({
      audioUrl: "https://media.example/audio",
      durationSeconds: 213,
      id: "abc123",
      title: "Never Gonna Give You Up",
      webpageUrl: "https://www.youtube.com/watch?v=abc123",
    });
  });

  it("falls back to the video id when metadata is missing", async () => {
    const format = {
      decipher: vi.fn(() => "https://media.example/audio"),
    };
    const info = fakeInfo({ videoId: "abc123", chooseFormat: format });
    const resolver = new YoutubeiResolver(fakeYoutube(info));

    const track = await resolver.getTrack("abc123");
    expect(track.id).toBe("abc123");
    expect(track.title).toBe("abc123");
    expect(track.durationSeconds).toBeUndefined();
  });

  it("throws when no playable audio format is available", async () => {
    const info = fakeInfo({ videoId: "abc123", chooseFormat: undefined });
    const resolver = new YoutubeiResolver(fakeYoutube(info));

    await expect(resolver.getTrack("abc123")).rejects.toThrow(
      "no playable audio format",
    );
  });

  it("throws when the deciphered url is not https", async () => {
    const format = { decipher: vi.fn(() => "http://insecure.example/a") };
    const info = fakeInfo({ videoId: "abc123", chooseFormat: format });
    const resolver = new YoutubeiResolver(fakeYoutube(info));

    await expect(resolver.getTrack("abc123")).rejects.toThrow(
      "invalid audio URL",
    );
  });

  it("returns just the audio url from getAudioUrl", async () => {
    const format = {
      decipher: vi.fn(() => "https://media.example/audio"),
    };
    const info = fakeInfo({ videoId: "abc123", chooseFormat: format });
    const resolver = new YoutubeiResolver(fakeYoutube(info));

    await expect(resolver.getAudioUrl("abc123")).resolves.toBe(
      "https://media.example/audio",
    );
  });
});
