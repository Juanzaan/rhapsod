import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  applyGain,
  AudioPlayer,
  type AudioPlayerClock,
} from "../src/audio/audio-player.js";
import {
  PCM_FRAME_BYTES,
  type RhapsodOpusEncoder,
} from "../src/audio/opus-encoder.js";

class ManualClock implements AudioPlayerClock {
  callback: (() => void) | undefined;
  start = vi.fn((callback: () => void) => {
    this.callback = callback;
  });
  stop = vi.fn(() => {
    this.callback = undefined;
  });
  tick(): void {
    this.callback?.();
  }
}

function setup() {
  const clock = new ManualClock();
  const encodeMock = vi.fn<(pcm: Uint8Array) => Uint8Array>((pcm) =>
    pcm.subarray(0, 10),
  );
  const encoder: RhapsodOpusEncoder = {
    close: vi.fn(),
    encode: encodeMock,
    pcmFrameBytes: PCM_FRAME_BYTES,
  };
  const output = { sendVoiceFrame: vi.fn() };
  return {
    clock,
    encodeMock,
    encoder,
    output,
    player: new AudioPlayer(encoder, output, clock),
  };
}

describe("AudioPlayer", () => {
  it("prebuffers 240ms of PCM and emits one exact frame per clock tick", () => {
    const { clock, encodeMock, output, player } = setup();
    const source = new PassThrough();
    void player.play(source);
    source.write(Buffer.alloc(PCM_FRAME_BYTES * 11, 7));
    expect(player.state).toBe("buffering");
    source.write(Buffer.alloc(PCM_FRAME_BYTES, 7));

    expect(player.state).toBe("playing");
    clock.tick();

    expect(encodeMock).toHaveBeenCalledWith(
      expect.objectContaining({ byteLength: PCM_FRAME_BYTES }),
    );
    expect(output.sendVoiceFrame).toHaveBeenCalledTimes(1);
    expect(player.metrics.framesSent).toBe(1);
    expect(player.metrics.firstFrameDelayMs).toBeGreaterThanOrEqual(0);
  });

  it("reassembles a PCM frame across source chunks", () => {
    const { clock, encodeMock, player } = setup();
    const source = new PassThrough();
    void player.play(source);
    source.write(Buffer.alloc(1_000, 1));
    source.write(Buffer.alloc(PCM_FRAME_BYTES * 25 - 1_000, 2));
    clock.tick();

    const pcm = encodeMock.mock.calls[0]?.[0];
    expect(pcm?.byteLength).toBe(PCM_FRAME_BYTES);
    expect(pcm?.[999]).toBe(1);
    expect(pcm?.[1_000]).toBe(2);
  });

  it("keeps the frame flow alive and resumes real frames after an underrun", () => {
    const { clock, encodeMock, output, player } = setup();
    const source = new PassThrough();
    void player.play(source);
    source.write(Buffer.alloc(PCM_FRAME_BYTES * 25, 3));
    for (let frame = 0; frame < 25; frame++) clock.tick();
    clock.tick();

    const silence = encodeMock.mock.calls.at(-1)?.[0];
    expect(silence?.every((value) => value === 0)).toBe(true);
    expect(player.metrics.underruns).toBe(1);
    expect(player.metrics.rebufferEvents).toBe(1);
    expect(player.state).toBe("playing");

    clock.tick();
    expect(output.sendVoiceFrame).toHaveBeenCalledTimes(27);
    expect(
      encodeMock.mock.calls.at(-1)?.[0]?.every((value) => value === 0),
    ).toBe(true);

    source.write(Buffer.alloc(PCM_FRAME_BYTES, 3));
    clock.tick();
    expect(output.sendVoiceFrame).toHaveBeenCalledTimes(28);
    expect(encodeMock.mock.calls.at(-1)?.[0]?.[0]).toBe(3);
  });

  it("fails when an underrun cannot recover within five seconds", async () => {
    vi.useFakeTimers();
    try {
      const { clock, player } = setup();
      const source = new PassThrough();
      const completion = player.play(source);
      const failure = expect(completion).rejects.toThrow(
        "Audio source stalled for 5000ms",
      );
      source.write(Buffer.alloc(PCM_FRAME_BYTES * 25));
      for (let frame = 0; frame <= 25; frame++) clock.tick();

      await vi.advanceTimersByTimeAsync(5_000);
      await failure;
      expect(player.state).toBe("idle");
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails when the source buffers without delivering data for too long", async () => {
    vi.useFakeTimers();
    try {
      const { player } = setup();
      const source = new PassThrough();
      const completion = player.play(source);

      const failure = expect(completion).rejects.toThrow(
        "Audio source stalled while buffering for 15000ms",
      );
      await vi.advanceTimersByTimeAsync(15_000);
      await failure;
      expect(player.state).toBe("idle");
    } finally {
      vi.useRealTimers();
    }
  });

  it("finishes after draining an ended source", async () => {
    const { clock, player } = setup();
    const source = new PassThrough();
    const completion = player.play(source);
    source.end(Buffer.alloc(PCM_FRAME_BYTES));
    await new Promise((resolve) => setImmediate(resolve));
    clock.tick();
    clock.tick();

    await expect(completion).resolves.toBeUndefined();
    expect(player.state).toBe("idle");
  });

  it("rejects playback when the source fails", async () => {
    const { player } = setup();
    const source = new PassThrough();
    const completion = player.play(source);
    source.destroy(new Error("source failed"));

    await expect(completion).rejects.toThrow("source failed");
    expect(player.state).toBe("idle");
  });

  it("pauses and resumes both the clock and source", () => {
    const { clock, player } = setup();
    const source = new PassThrough();
    const pause = vi.spyOn(source, "pause");
    const resume = vi.spyOn(source, "resume");
    void player.play(source);
    source.write(Buffer.alloc(PCM_FRAME_BYTES * 25));

    player.pause();
    expect(player.state).toBe("paused");
    expect(clock.stop).toHaveBeenCalled();
    expect(pause).toHaveBeenCalled();

    player.resume();
    expect(player.state).toBe("playing");
    expect(clock.start).toHaveBeenCalledTimes(2);
    expect(resume).toHaveBeenCalled();
  });

  it("destroys the PCM source when playback is stopped", async () => {
    const { player } = setup();
    const source = new PassThrough();
    const completion = player.play(source);

    player.stop();

    await expect(completion).resolves.toBeUndefined();
    expect(source.destroyed).toBe(true);
    expect(player.state).toBe("idle");
  });

  it("reuses pooled frame buffers across ticks at full gain", () => {
    const { clock, encodeMock, player } = setup();
    const source = new PassThrough();
    void player.play(source);
    source.write(Buffer.alloc(PCM_FRAME_BYTES * 25, 9));
    clock.tick();
    clock.tick();

    const first = encodeMock.mock.calls[0]?.[0];
    const second = encodeMock.mock.calls[1]?.[0];
    expect(first?.byteLength).toBe(PCM_FRAME_BYTES);
    expect(second).toBe(first);
  });

  it("applies the configured gain to encoded frames", () => {
    const { clock, encodeMock, player } = setup();
    const source = new PassThrough();
    void player.play(source);
    player.setVolume(0.5);
    const frame = Buffer.alloc(PCM_FRAME_BYTES * 12);
    frame[0] = 0x10;
    frame[1] = 0x10;
    source.write(frame);
    clock.tick();

    const pcm = encodeMock.mock.calls[0]?.[0];
    expect(pcm?.[0]).toBe(0x08);
    expect(pcm?.[1]).toBe(0x08);
  });
});

describe("applyGain", () => {
  it("returns the same buffer at full gain", () => {
    const pcm = new Uint8Array([0x34, 0x12, 0x00, 0x80]);
    expect(applyGain(pcm, 1)).toBe(pcm);
  });

  it("scales sample amplitudes", () => {
    const pcm = new Uint8Array(PCM_FRAME_BYTES);
    pcm[0] = 0xfe;
    pcm[1] = 0x7f;
    pcm[2] = 0x00;
    pcm[3] = 0x80;

    const output = applyGain(pcm, 0.5);

    expect(output[0]).toBe(0xff);
    expect(output[1]).toBe(0x3f);
    expect(output[2]).toBe(0x00);
    expect(output[3]).toBe(0xc0);
  });

  it("clamps samples to the int16 range", () => {
    const pcm = new Uint8Array(PCM_FRAME_BYTES);
    pcm[0] = 0xff;
    pcm[1] = 0x7f;

    const output = applyGain(pcm, 2);

    expect(output[0]).toBe(0xff);
    expect(output[1]).toBe(0x7f);
  });

  it("zeroes the frame at zero gain", () => {
    const pcm = new Uint8Array(PCM_FRAME_BYTES);
    pcm.fill(7);

    expect(Array.from(applyGain(pcm, 0))).toEqual(
      new Array(PCM_FRAME_BYTES).fill(0),
    );
  });
});
