import { describe, expect, it, vi } from "vitest";

import { YoutubePlaybackService } from "../src/application/youtube-playback-service.js";
import type { YoutubeTrackMetadata } from "../src/media/youtube/yt-dlp.js";
import type { FfmpegPlaybackSession } from "../src/audio/ffmpeg-player.js";
import type { AudioPlayer } from "../src/audio/audio-player.js";
import type { RhapsodOpusEncoder } from "../src/audio/opus-encoder.js";

function setup() {
  const stopSession = vi.fn();
  const playbackResolvers: Array<() => void> = [];
  const createPlayback = vi.fn((): FfmpegPlaybackSession => ({
    done: new Promise<void>((resolve) => playbackResolvers.push(resolve)),
    player: {} as AudioPlayer,
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
  };
  const encoder: RhapsodOpusEncoder = {
    close: vi.fn(),
    encode: vi.fn(),
    pcmFrameBytes: 3_840,
  };
  const onPlaybackError = vi.fn();
  const onPlaybackStarted = vi.fn();
  const service = new YoutubePlaybackService({
    createPlayback,
    encoder,
    onPlaybackError,
    onPlaybackStarted,
    output: { sendVoiceFrame: vi.fn() },
    resolver,
  });
  return {
    createPlayback,
    onPlaybackError,
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

  it("advances to the next track when playback completes", async () => {
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
    await service.enqueue("https://youtu.be/first", "user-1");
    await service.enqueue("https://youtu.be/second", "user-2");
    await new Promise((resolve) => setImmediate(resolve));

    expect(resolver.getAudioUrlFromUrl).toHaveBeenCalledWith(
      "https://www.youtube.com/watch?v=second",
    );

    playbackResolvers[0]?.();
    await new Promise((resolve) => setImmediate(resolve));

    expect(service.current?.id).toBe("second");
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
    ).rejects.toThrow("Only YouTube");
  });
});
