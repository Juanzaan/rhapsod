import { describe, expect, it, vi } from "vitest";

import type { MinimalLogger } from "../src/observability/logger.js";
import type { YoutubeResource } from "../src/media/media-input.js";
import type { YoutubePlaybackResolver } from "../src/media/youtube/youtube-resolver.js";
import { YoutubeResolverWithFallback } from "../src/media/youtube/youtube-resolver-with-fallback.js";
import type { YoutubeiResolver } from "../src/media/youtube/youtubei-resolver.js";

const VIDEO_URL = "https://www.youtube.com/watch?v=abc123";

function videoResource(id = "abc123"): YoutubeResource {
  return { type: "video", id } as unknown as YoutubeResource;
}

function playlistResource(id = "pl123"): YoutubeResource {
  return { type: "playlist", id } as unknown as YoutubeResource;
}

function fakePrimary(): {
  getAudioUrl: ReturnType<typeof vi.fn>;
  getTrack: ReturnType<typeof vi.fn>;
  resolver: YoutubeiResolver;
} {
  const getTrack = vi.fn();
  const getAudioUrl = vi.fn();
  return {
    getAudioUrl,
    getTrack,
    resolver: { getTrack, getAudioUrl } as unknown as YoutubeiResolver,
  };
}

function fakeFallback(): {
  expandPlaylist: ReturnType<typeof vi.fn>;
  getAudioUrlFromUrl: ReturnType<typeof vi.fn>;
  getTrack: ReturnType<typeof vi.fn>;
  getTrackFromUrl: ReturnType<typeof vi.fn>;
  search: ReturnType<typeof vi.fn>;
  searchMany: ReturnType<typeof vi.fn>;
} {
  return {
    getAudioUrlFromUrl: vi.fn(),
    getTrack: vi.fn(),
    getTrackFromUrl: vi.fn(),
    search: vi.fn(),
    searchMany: vi.fn(),
    expandPlaylist: vi.fn(),
  };
}

const logger = {
  debug: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  info: vi.fn(),
  trace: vi.fn(),
  warn: vi.fn(),
} as unknown as MinimalLogger;

function makeWrapper(
  primary: YoutubeiResolver | undefined,
  fallback: ReturnType<typeof fakeFallback>,
): YoutubeResolverWithFallback {
  return new YoutubeResolverWithFallback(
    primary,
    fallback as unknown as YoutubePlaybackResolver,
    logger,
  );
}

describe("YoutubeResolverWithFallback getTrack", () => {
  it("uses youtubei.js when it succeeds", async () => {
    const primary = fakePrimary();
    const fallback = fakeFallback();
    primary.getTrack.mockResolvedValue({
      id: "abc123",
      title: "from primary",
      webpageUrl: VIDEO_URL,
    });
    const wrapper = makeWrapper(primary.resolver, fallback);

    await expect(wrapper.getTrack(videoResource())).resolves.toMatchObject({
      title: "from primary",
    });
    expect(primary.getTrack).toHaveBeenCalledWith("abc123");
    expect(fallback.getTrack).not.toHaveBeenCalled();
  });

  it("falls back to yt-dlp when youtubei.js fails", async () => {
    const primary = fakePrimary();
    const fallback = fakeFallback();
    primary.getTrack.mockRejectedValue(new Error("bot check"));
    fallback.getTrack.mockResolvedValue({
      id: "abc123",
      title: "from fallback",
      webpageUrl: VIDEO_URL,
    });
    const wrapper = makeWrapper(primary.resolver, fallback);

    await expect(wrapper.getTrack(videoResource())).resolves.toMatchObject({
      title: "from fallback",
    });
    expect(fallback.getTrack).toHaveBeenCalledWith(videoResource());
    expect(logger.warn).toHaveBeenCalled();
  });

  it("uses yt-dlp directly when youtubei.js is unavailable", async () => {
    const fallback = fakeFallback();
    fallback.getTrack.mockResolvedValue({
      id: "abc123",
      title: "from fallback",
      webpageUrl: VIDEO_URL,
    });
    const wrapper = makeWrapper(undefined, fallback);

    await expect(wrapper.getTrack(videoResource())).resolves.toMatchObject({
      title: "from fallback",
    });
    expect(fallback.getTrack).toHaveBeenCalled();
  });

  it("never sends playlists to youtubei.js", async () => {
    const primary = fakePrimary();
    const fallback = fakeFallback();
    fallback.getTrack.mockResolvedValue({
      id: "pl-track",
      title: "from fallback",
      webpageUrl: "https://youtu.be/pl-track",
    });
    const wrapper = makeWrapper(primary.resolver, fallback);

    await wrapper.getTrack(playlistResource());
    expect(primary.getTrack).not.toHaveBeenCalled();
    expect(fallback.getTrack).toHaveBeenCalled();
  });
});

describe("YoutubeResolverWithFallback getAudioUrlFromUrl", () => {
  it("uses youtubei.js for a youtube url when it succeeds", async () => {
    const primary = fakePrimary();
    const fallback = fakeFallback();
    primary.getAudioUrl.mockResolvedValue("https://media.example/audio");
    const wrapper = makeWrapper(primary.resolver, fallback);

    await expect(wrapper.getAudioUrlFromUrl(VIDEO_URL)).resolves.toBe(
      "https://media.example/audio",
    );
    expect(primary.getAudioUrl).toHaveBeenCalledWith("abc123");
    expect(fallback.getAudioUrlFromUrl).not.toHaveBeenCalled();
  });

  it("falls back to yt-dlp when youtubei.js fails", async () => {
    const primary = fakePrimary();
    const fallback = fakeFallback();
    primary.getAudioUrl.mockRejectedValue(new Error("bot check"));
    fallback.getAudioUrlFromUrl.mockResolvedValue("https://media.example/dl");
    const wrapper = makeWrapper(primary.resolver, fallback);

    await expect(wrapper.getAudioUrlFromUrl(VIDEO_URL)).resolves.toBe(
      "https://media.example/dl",
    );
    expect(fallback.getAudioUrlFromUrl).toHaveBeenCalledWith(
      VIDEO_URL,
      undefined,
    );
  });

  it("skips youtubei.js for non-youtube urls", async () => {
    const primary = fakePrimary();
    const fallback = fakeFallback();
    fallback.getAudioUrlFromUrl.mockResolvedValue("https://media.example/sc");
    const wrapper = makeWrapper(primary.resolver, fallback);

    await expect(
      wrapper.getAudioUrlFromUrl("https://soundcloud.com/a/track"),
    ).resolves.toBe("https://media.example/sc");
    expect(primary.getAudioUrl).not.toHaveBeenCalled();
  });

  it("skips youtubei.js when the request is already aborted", async () => {
    const primary = fakePrimary();
    const fallback = fakeFallback();
    fallback.getAudioUrlFromUrl.mockResolvedValue("https://media.example/dl");
    const wrapper = makeWrapper(primary.resolver, fallback);

    const controller = new AbortController();
    controller.abort();
    await expect(
      wrapper.getAudioUrlFromUrl(VIDEO_URL, controller.signal),
    ).resolves.toBe("https://media.example/dl");
    expect(primary.getAudioUrl).not.toHaveBeenCalled();
  });
});

describe("YoutubeResolverWithFallback delegation", () => {
  it("delegates search, searchMany, expandPlaylist and getTrackFromUrl to yt-dlp", async () => {
    const fallback = fakeFallback();
    const wrapper = makeWrapper(undefined, fallback);

    void wrapper.search("duki rockstar");
    void wrapper.searchMany("duki rockstar", undefined, 3);
    void wrapper.expandPlaylist(playlistResource(), 20);
    await wrapper.getTrackFromUrl(VIDEO_URL);

    expect(fallback.search).toHaveBeenCalledWith("duki rockstar", undefined, undefined);
    expect(fallback.searchMany).toHaveBeenCalledWith(
      "duki rockstar",
      undefined,
      3,
    );
    expect(fallback.expandPlaylist).toHaveBeenCalledWith(
      playlistResource(),
      20,
    );
    expect(fallback.getTrackFromUrl).toHaveBeenCalledWith(VIDEO_URL);
  });
});
