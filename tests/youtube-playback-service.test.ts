import { describe, expect, it, vi } from "vitest";

import { YoutubePlaybackService } from "../src/application/youtube-playback-service.js";
import type { YoutubePlaybackResolver } from "../src/application/youtube-playback-service.js";
import type { YoutubeTrackMetadata } from "../src/media/youtube/yt-dlp.js";
import { SoundCloudDrmError } from "../src/media/soundcloud/public-api.js";
import type { AlternativeSourceResolver } from "../src/media/song-link.js";
import type { FfmpegPlaybackSession } from "../src/audio/ffmpeg-player.js";
import type { AudioPlayer } from "../src/audio/audio-player.js";
import type { RhapsodOpusEncoder } from "../src/audio/opus-encoder.js";

function setup(options: { soundcloudResolver?: boolean } = {}) {
  const stopSession = vi.fn();
  const playbackResolvers: Array<() => void> = [];
  const createPlayback = vi.fn((): FfmpegPlaybackSession => ({
    done: new Promise<void>((resolve) => playbackResolvers.push(resolve)),
    player: {
      metrics: {
        bufferedBytes: 0,
        framesSent: 1,
        maxBufferedBytes: 3_840,
        rebufferEvents: 0,
        underruns: 0,
      },
    } as AudioPlayer,
    stop: stopSession,
  }));
  const resolver = {
    getAudioUrl: vi.fn(() => Promise.resolve("https://media.example/audio")),
    getAudioUrlFromUrl: vi.fn(() =>
      Promise.resolve("https://media.example/audio"),
    ),
    getTrack: vi.fn((resource: { id: string }): Promise<YoutubeTrackMetadata> =>
      Promise.resolve({
        audioUrl: `https://media.example/${resource.id}`,
        id: resource.id,
        title: `Track ${resource.id}`,
        webpageUrl: `https://www.youtube.com/watch?v=${resource.id}`,
      }),
    ),
    getTrackFromUrl: vi.fn((url: string): Promise<YoutubeTrackMetadata> =>
      Promise.resolve({
        audioUrl: "https://media.example/soundcloud-track",
        id: "soundcloud-track",
        title: "SoundCloud Track",
        webpageUrl: url,
      }),
    ),
    search: vi.fn((query: string): Promise<YoutubeTrackMetadata> =>
      Promise.resolve({
        audioUrl: "https://media.example/search-result",
        id: "search-result",
        title: `Search ${query}`,
        webpageUrl: "https://www.youtube.com/watch?v=search-result",
      }),
    ),
    expandPlaylist: vi.fn<YoutubePlaybackResolver["expandPlaylist"]>(() =>
      Promise.resolve({ tracks: [] }),
    ),
  };
  const encoder: RhapsodOpusEncoder = {
    close: vi.fn(),
    encode: vi.fn(),
    pcmFrameBytes: 3_840,
  };
  const alternativeResolver = {
    findAlternative: vi.fn<AlternativeSourceResolver["findAlternative"]>(() =>
      Promise.resolve({
        provider: "youtube" as const,
        url: "https://youtu.be/fallback",
      }),
    ),
  };
  const onPlaybackError = vi.fn();
  const onPlaybackFinished = vi.fn();
  const onPlaybackStarted = vi.fn();
  const service = new YoutubePlaybackService({
    createPlayback,
    encoder,
    onPlaybackError,
    onPlaybackFinished,
    onPlaybackStarted,
    output: { sendVoiceFrame: vi.fn() },
    resolver,
    alternativeResolver,
    ...(options.soundcloudResolver
      ? {
          soundcloudResolver: {
            getAudioUrl: vi.fn(() =>
              Promise.resolve("https://media.example/soundcloud-api"),
            ),
            getTrack: vi.fn(() =>
              Promise.reject(new Error("SoundCloud API returned 503")),
            ),
            match: vi.fn((input: string) => input.includes("soundcloud.com")),
            name: "soundcloud",
          },
        }
      : {}),
  });
  return {
    alternativeResolver,
    createPlayback,
    onPlaybackError,
    onPlaybackFinished,
    onPlaybackStarted,
    playbackResolvers,
    resolver,
    service,
    stopSession,
  };
}

describe("YoutubePlaybackService", () => {
  it("queues the first resolved YouTube search result", async () => {
    const { resolver, service } = setup();

    const track = await service.enqueueSearch("duki rockstar", "user-1");

    expect(resolver.search).toHaveBeenCalledWith("duki rockstar");
    expect(track).toMatchObject({
      id: "search-result",
      requestedBy: "user-1",
      title: "Search duki rockstar",
    });
  });

  it("resolves metadata, queues a track, and resolves audio at playback time", async () => {
    const { createPlayback, onPlaybackStarted, resolver, service } = setup();

    const track = await service.enqueue("https://youtu.be/abc123", "user-1");
    await new Promise((resolve) => setImmediate(resolve));

    expect(track.title).toBe("Track abc123");
    expect(service.current).toEqual(track);
    expect(resolver.getAudioUrlFromUrl).not.toHaveBeenCalled();
    expect(createPlayback).toHaveBeenCalledWith(
      "https://media.example/abc123",
      expect.anything(),
      expect.anything(),
    );
    expect(onPlaybackStarted).toHaveBeenCalledWith(track);
  });

  it("queues and plays a SoundCloud track through the shared resolver", async () => {
    const { resolver, service } = setup();

    const track = await service.enqueue(
      "https://soundcloud.com/artist/track",
      "user-1",
    );

    expect(resolver.getTrackFromUrl).toHaveBeenCalledWith(
      "https://soundcloud.com/artist/track",
    );
    expect(track).toMatchObject({
      id: "soundcloud-track",
      source: "https://soundcloud.com/artist/track",
      title: "SoundCloud Track",
    });
  });

  it("falls back to YouTube when SoundCloud reports DRM", async () => {
    const { resolver, service } = setup();
    resolver.getTrackFromUrl
      .mockRejectedValueOnce(new Error("This video is DRM protected"))
      .mockResolvedValueOnce({
        id: "fallback",
        title: "Fallback Track",
        webpageUrl: "https://www.youtube.com/watch?v=fallback",
      });

    const track = await service.enqueue(
      "https://soundcloud.com/artist/track",
      "user-1",
    );

    expect(resolver.getTrackFromUrl).toHaveBeenNthCalledWith(
      2,
      "https://youtu.be/fallback",
    );
    expect(track).toMatchObject({
      alternativeProvider: "youtube",
      title: "Fallback Track",
    });
  });

  it("falls back to yt-dlp when the public SoundCloud API is unavailable", async () => {
    const { resolver, service } = setup({ soundcloudResolver: true });

    const track = await service.enqueue(
      "https://soundcloud.com/artist/track",
      "user-1",
    );

    expect(resolver.getTrackFromUrl).toHaveBeenCalledWith(
      "https://soundcloud.com/artist/track",
    );
    expect(track.title).toBe("SoundCloud Track");
  });

  it("advances to the next track when playback completes", async () => {
    const { onPlaybackFinished, playbackResolvers, resolver, service } =
      setup();
    resolver.getTrack.mockImplementation((resource: { id: string }) =>
      Promise.resolve({
        ...(resource.id === "first"
          ? { audioUrl: "https://media.example/first" }
          : {}),
        id: resource.id,
        title: `Track ${resource.id}`,
        webpageUrl: `https://www.youtube.com/watch?v=${resource.id}`,
      }),
    );
    await service.enqueue("https://youtu.be/first", "user-1");
    await service.enqueue("https://youtu.be/second", "user-2");
    await new Promise((resolve) => setImmediate(resolve));

    expect(resolver.getAudioUrlFromUrl).toHaveBeenCalledWith(
      "https://www.youtube.com/watch?v=second",
    );

    playbackResolvers[0]?.();
    await new Promise((resolve) => setImmediate(resolve));

    expect(service.current?.id).toBe("second");
    expect(onPlaybackFinished).toHaveBeenCalledWith(
      expect.objectContaining({ id: "first" }),
      expect.anything(),
      "completed",
    );
  });

  it("reports skipped and stopped sessions separately", async () => {
    const { onPlaybackFinished, playbackResolvers, service } = setup();
    await service.enqueue("https://youtu.be/first", "user-1");
    await new Promise((resolve) => setImmediate(resolve));

    service.skip();
    playbackResolvers[0]?.();
    await new Promise((resolve) => setImmediate(resolve));
    expect(onPlaybackFinished).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "first" }),
      expect.anything(),
      "skipped",
    );

    await service.enqueue("https://youtu.be/second", "user-1");
    await new Promise((resolve) => setImmediate(resolve));
    service.stop();
    playbackResolvers[1]?.();
    await new Promise((resolve) => setImmediate(resolve));
    expect(onPlaybackFinished).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "second" }),
      expect.anything(),
      "stopped",
    );
  });

  it("falls back to resolving playback when prefetched audio fails", async () => {
    const { playbackResolvers, resolver, service } = setup();
    resolver.getTrack.mockImplementation((resource: { id: string }) =>
      Promise.resolve({
        ...(resource.id === "first"
          ? { audioUrl: "https://media.example/first" }
          : {}),
        id: resource.id,
        title: `Track ${resource.id}`,
        webpageUrl: `https://www.youtube.com/watch?v=${resource.id}`,
      }),
    );
    resolver.getAudioUrlFromUrl
      .mockRejectedValueOnce(new Error("prefetch failed"))
      .mockResolvedValueOnce("https://media.example/fallback");

    await service.enqueue("https://youtu.be/first", "user-1");
    await service.enqueue("https://youtu.be/second", "user-2");
    await new Promise((resolve) => setImmediate(resolve));
    playbackResolvers[0]?.();
    await new Promise((resolve) => setImmediate(resolve));

    expect(resolver.getAudioUrlFromUrl).toHaveBeenCalledTimes(2);
    expect(service.current?.id).toBe("second");
  });

  it("stops the active session and clears the queue", async () => {
    const { service, stopSession } = setup();
    await service.enqueue("https://youtu.be/first", "user-1");
    await service.enqueue("https://youtu.be/second", "user-2");
    await new Promise((resolve) => setImmediate(resolve));

    service.stop();

    expect(stopSession).toHaveBeenCalled();
    expect(service.current).toBeUndefined();
    expect(service.queue()).toEqual([]);
  });

  it("removes queued tracks without stopping the current track", async () => {
    const { service } = setup();
    await service.enqueue("https://youtu.be/first", "user-1");
    await service.enqueue("https://youtu.be/second", "user-2");
    await new Promise((resolve) => setImmediate(resolve));

    expect(service.removeQueued(1)?.id).toBe("second");
    expect(service.queue()).toEqual([]);
    expect(service.current?.id).toBe("first");
  });

  it("reports playback failures before advancing the queue", async () => {
    const { onPlaybackError, resolver, service } = setup();
    resolver.getTrack.mockResolvedValueOnce({
      id: "failed",
      title: "Track failed",
      webpageUrl: "https://www.youtube.com/watch?v=failed",
    });
    resolver.getAudioUrlFromUrl.mockRejectedValueOnce(
      new Error("audio unavailable"),
    );

    await service.enqueue("https://youtu.be/failed", "user-1");
    await new Promise((resolve) => setImmediate(resolve));

    expect(onPlaybackError).toHaveBeenCalledWith(
      expect.objectContaining({ id: "failed" }),
      expect.objectContaining({ message: "audio unavailable" }),
    );
  });

  it("rejects unsupported providers before queueing", async () => {
    const { service } = setup();

    await expect(
      service.enqueue("https://open.spotify.com/track/abc123", "user-1"),
    ).rejects.toThrow("Los links de Spotify todavía no están soportados");
  });

  it("falls back to a YouTube search when given plain text", async () => {
    const { resolver, service } = setup();

    const track = await service.enqueue("duki rockstar", "user-1");

    expect(resolver.search).toHaveBeenCalledWith("duki rockstar");
    expect(track).toMatchObject({
      id: "search-result",
      requestedBy: "user-1",
      title: "Search duki rockstar",
    });
  });

  it("rejects explicit local file inputs", async () => {
    const { service } = setup();

    await expect(
      service.enqueue("file:/tmp/song.mp3", "user-1"),
    ).rejects.toThrow("Los archivos locales no están soportados");
  });

  it("rejects unrecognized generic URLs", async () => {
    const { service } = setup();

    await expect(
      service.enqueue("https://example.com/some-page", "user-1"),
    ).rejects.toThrow("No reconozco ese link");
  });

  it("falls back to the next ranked candidate when audio is unavailable", async () => {
    const { createPlayback, onPlaybackError, resolver, service } = setup();
    resolver.getTrack.mockResolvedValueOnce({
      fallbackSources: ["https://www.youtube.com/watch?v=second"],
      id: "best",
      title: "Track best",
      webpageUrl: "https://www.youtube.com/watch?v=best",
    });
    resolver.getAudioUrlFromUrl
      .mockRejectedValueOnce(new Error("Requested format is not available"))
      .mockResolvedValueOnce("https://media.example/second-audio");

    await service.enqueue("https://youtu.be/best", "user-1");
    await new Promise((resolve) => setImmediate(resolve));

    expect(resolver.getAudioUrlFromUrl).toHaveBeenNthCalledWith(
      1,
      "https://www.youtube.com/watch?v=best",
    );
    expect(resolver.getAudioUrlFromUrl).toHaveBeenNthCalledWith(
      2,
      "https://www.youtube.com/watch?v=second",
    );
    expect(createPlayback).toHaveBeenCalledWith(
      "https://media.example/second-audio",
      expect.anything(),
      expect.anything(),
    );
    expect(onPlaybackError).not.toHaveBeenCalled();
  });

  it("reports the failure when every candidate has no playable audio", async () => {
    const { onPlaybackError, resolver, service } = setup();
    resolver.getTrack.mockResolvedValueOnce({
      fallbackSources: ["https://www.youtube.com/watch?v=second"],
      id: "best",
      title: "Track best",
      webpageUrl: "https://www.youtube.com/watch?v=best",
    });
    resolver.getAudioUrlFromUrl.mockRejectedValue(
      new Error("Requested format is not available"),
    );

    await service.enqueue("https://youtu.be/best", "user-1");
    await new Promise((resolve) => setImmediate(resolve));

    expect(onPlaybackError).toHaveBeenCalledWith(
      expect.objectContaining({ id: "best" }),
      expect.objectContaining({
        message: "Requested format is not available",
      }),
    );
  });

  it("searches YouTube by metadata when SoundCloud is DRM without a SongLink match", async () => {
    const { alternativeResolver, resolver, service } = setup();
    alternativeResolver.findAlternative.mockResolvedValueOnce(undefined);
    resolver.getTrackFromUrl.mockRejectedValueOnce(
      new SoundCloudDrmError({
        artist: "Kanye West",
        durationSeconds: 224,
        title: "OK (feat. Don Toliver)",
      }),
    );
    resolver.search.mockResolvedValueOnce({
      id: "yt-fallback",
      title: "Kanye West - OK (Official Audio)",
      webpageUrl: "https://www.youtube.com/watch?v=yt-fallback",
    });

    const track = await service.enqueue(
      "https://on.soundcloud.com/0Tbj4O1F7XxfV6DDjQ",
      "user-1",
    );

    expect(resolver.search).toHaveBeenCalledWith(
      "Kanye West OK (feat. Don Toliver)",
    );
    expect(track).toMatchObject({
      alternativeProvider: "youtube",
      id: "yt-fallback",
      title: "Kanye West - OK (Official Audio)",
    });
  });

  it("keeps the DRM error when metadata search finds no reliable match", async () => {
    const { alternativeResolver, resolver, service } = setup();
    alternativeResolver.findAlternative.mockResolvedValueOnce(undefined);
    resolver.getTrackFromUrl.mockRejectedValueOnce(
      new SoundCloudDrmError({
        artist: "Kanye West",
        title: "OK (feat. Don Toliver)",
      }),
    );
    resolver.search.mockRejectedValueOnce(
      new Error("No encontré una coincidencia confiable en YouTube"),
    );

    await expect(
      service.enqueue("https://on.soundcloud.com/0Tbj4O1F7XxfV6DDjQ", "user-1"),
    ).rejects.toThrow("DRM protected");
  });

  it("enqueues a YouTube playlist up to the limit and reports the remainder", async () => {
    const { resolver, service } = setup();
    resolver.expandPlaylist.mockResolvedValueOnce({
      total: 5,
      tracks: [1, 2, 3].map((index) => ({
        id: `p${index}`,
        title: `Playlist Track ${index}`,
        webpageUrl: `https://www.youtube.com/watch?v=p${index}`,
      })),
    });

    const result = await service.enqueuePlaylist(
      { id: "PL1", type: "playlist" },
      "user-1",
    );

    expect(resolver.expandPlaylist).toHaveBeenCalledWith(
      { id: "PL1", type: "playlist" },
      20,
    );
    expect(result).toMatchObject({
      added: [
        expect.objectContaining({
          id: "p1",
          requestedBy: "user-1",
          title: "Playlist Track 1",
        }),
        expect.objectContaining({ id: "p2" }),
        expect.objectContaining({ id: "p3" }),
      ],
      remaining: 2,
    });
    expect(service.current?.id).toBe("p1");
    expect(service.queue()).toHaveLength(2);
  });

  it("truncates a playlist beyond the configured limit", async () => {
    const { resolver, service } = setup();
    resolver.expandPlaylist.mockResolvedValueOnce({
      total: 25,
      tracks: Array.from({ length: 25 }, (_, index) => ({
        id: `p${index + 1}`,
        title: `Playlist Track ${index + 1}`,
        webpageUrl: `https://www.youtube.com/watch?v=p${index + 1}`,
      })),
    });

    const result = await service.enqueuePlaylist(
      { id: "PL2", type: "playlist" },
      "user-1",
    );

    expect(result.added).toHaveLength(20);
    expect(result.remaining).toBe(5);
  });

  it("skips duplicate tracks while expanding a playlist", async () => {
    const { resolver, service } = setup();
    resolver.expandPlaylist.mockResolvedValueOnce({
      total: 3,
      tracks: [
        {
          id: "dup",
          title: "Duplicate Track",
          webpageUrl: "https://www.youtube.com/watch?v=dup",
        },
        {
          id: "dup",
          title: "Duplicate Track",
          webpageUrl: "https://www.youtube.com/watch?v=dup",
        },
        {
          id: "fresh",
          title: "Fresh Track",
          webpageUrl: "https://www.youtube.com/watch?v=fresh",
        },
      ],
    });

    const result = await service.enqueuePlaylist(
      { id: "PL3", type: "playlist" },
      "user-1",
    );

    expect(result.added.map((track) => track.id)).toEqual(["dup", "fresh"]);
    expect(result.remaining).toBe(0);
    expect(service.queue()).toHaveLength(1);
  });

  it("rejects expanding a video resource as a playlist", async () => {
    const { service } = setup();

    await expect(
      service.enqueuePlaylist({ id: "v1", type: "video" }, "user-1"),
    ).rejects.toThrow("Only YouTube playlists can be expanded");
  });
});
