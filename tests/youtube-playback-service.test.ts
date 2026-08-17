import { describe, expect, it, vi } from "vitest";

import { YoutubePlaybackService } from "../src/application/youtube-playback-service.js";
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
    getTrack: vi.fn((resource: { id: string }) =>
      Promise.resolve({
        id: resource.id,
        title: `Track ${resource.id}`,
        webpageUrl: `https://www.youtube.com/watch?v=${resource.id}`,
      }),
    ),
  };
  const encoder: RhapsodOpusEncoder = {
    close: vi.fn(),
    encode: vi.fn(),
    pcmFrameBytes: 3_840,
  };
  const service = new YoutubePlaybackService({
    createPlayback,
    encoder,
    output: { sendVoiceFrame: vi.fn() },
    resolver,
  });
  return { createPlayback, playbackResolvers, resolver, service, stopSession };
}

describe("YoutubePlaybackService", () => {
  it("resolves metadata, queues a track, and resolves audio at playback time", async () => {
    const { createPlayback, resolver, service } = setup();

    const track = await service.enqueue("https://youtu.be/abc123", "user-1");
    await new Promise((resolve) => setImmediate(resolve));

    expect(track.title).toBe("Track abc123");
    expect(service.current).toEqual(track);
    expect(resolver.getAudioUrl).toHaveBeenCalledWith({
      id: "abc123",
      type: "video",
    });
    expect(createPlayback).toHaveBeenCalledWith(
      "https://media.example/audio",
      expect.anything(),
      expect.anything(),
    );
  });

  it("advances to the next track when playback completes", async () => {
    const { playbackResolvers, service } = setup();
    await service.enqueue("https://youtu.be/first", "user-1");
    await service.enqueue("https://youtu.be/second", "user-2");
    await new Promise((resolve) => setImmediate(resolve));

    playbackResolvers[0]?.();
    await new Promise((resolve) => setImmediate(resolve));

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

  it("rejects unsupported providers before queueing", async () => {
    const { service } = setup();

    await expect(
      service.enqueue("https://open.spotify.com/track/abc123", "user-1"),
    ).rejects.toThrow("Only YouTube");
  });
});
