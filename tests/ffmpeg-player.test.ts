import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { playFfmpegUrl, playPcmStream } from "../src/audio/ffmpeg-player.js";
import type { RhapsodOpusEncoder } from "../src/audio/opus-encoder.js";
import type { FfmpegPcmStream } from "../src/audio/ffmpeg-pcm.js";

function fakeStream() {
  const stop = vi.fn();
  const stream: FfmpegPcmStream = {
    process: {
      exitCode: null,
      signalCode: null,
      kill: () => true,
      on: vi.fn(),
      once: vi.fn(),
      stderr: { on: vi.fn() },
      stdout: { pipe: vi.fn(), unpipe: vi.fn() },
    } as unknown as FfmpegPcmStream["process"],
    stop,
    stream: new PassThrough(),
  };
  return { stream, stop };
}

function encoder(): RhapsodOpusEncoder {
  return {
    close: vi.fn(),
    encode: (pcm: Uint8Array) => pcm.subarray(0, 10),
    pcmFrameBytes: 0,
  };
}

describe("ffmpeg-player", () => {
  it("stops the stream when the session is stopped", async () => {
    const { stream, stop } = fakeStream();
    const session = playPcmStream(stream, encoder(), {
      sendVoiceFrame: vi.fn(),
    });
    session.stop();
    await expect(session.done).resolves.toBeUndefined();
    expect(stop).toHaveBeenCalled();
  });

  it("playFfmpegUrl wires a fresh stream into a session", () => {
    const { stream, stop } = fakeStream();
    const createStream = vi.fn(() => stream);
    const session = playFfmpegUrl(
      "https://cdn.example.test/audio",
      encoder(),
      { sendVoiceFrame: vi.fn() },
      { createStream },
    );
    expect(createStream).toHaveBeenCalled();
    session.stop();
    expect(stop).toHaveBeenCalled();
  });

  it("playFfmpegUrl reuses a pre-spawned stream instead of spawning a new one", () => {
    const preSpawned = fakeStream();
    const createStream = vi.fn(() => fakeStream().stream);
    const session = playFfmpegUrl(
      "https://cdn.example.test/audio",
      encoder(),
      { sendVoiceFrame: vi.fn() },
      { createStream, stream: preSpawned.stream },
    );
    expect(createStream).not.toHaveBeenCalled();
    session.stop();
    expect(preSpawned.stop).toHaveBeenCalled();
  });
});
