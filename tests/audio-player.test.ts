import { PassThrough } from "node:stream";

import { createDecoder } from "libopus-wasm";
import { describe, expect, it, vi } from "vitest";

import {
  AudioPlayer,
  type AudioPlayerClock,
  isMidPlayStall,
} from "../src/audio/audio-player.js";
import {
  createRhapsodOpusEncoder,
  PCM_FRAME_BYTES,
  type RhapsodOpusEncoder,
  SAMPLES_PER_CHANNEL,
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
  const encodeMock = vi.fn<(pcm: Uint8Array, gain?: number) => Uint8Array>(
    (pcm) => pcm.subarray(0, 10),
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
  it("stamps the last frame of source audio, not the silence after it", () => {
    vi.useFakeTimers({ now: 10_000 });
    try {
      const { clock, player } = setup();
      const source = new PassThrough();
      void player.play(source);
      expect(player.metrics).not.toHaveProperty("lastAudioFrameAt");
      source.write(Buffer.alloc(PCM_FRAME_BYTES * 16, 7));
      clock.tick();
      vi.setSystemTime(10_500);
      clock.tick();
      expect(player.metrics.lastAudioFrameAt).toBe(10_500);

      for (let frame = 0; frame < 14; frame++) clock.tick();
      vi.setSystemTime(11_000);
      clock.tick(); // buffer empty: an underrun frame of silence
      expect(player.metrics.underruns).toBe(1);
      expect(player.metrics.lastAudioFrameAt).toBe(10_500);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ends on the tick that sends the last audio frame", async () => {
    const { clock, output, player } = setup();
    const source = new PassThrough();
    let finished = false;
    void player.play(source).then(() => (finished = true));
    source.end(Buffer.alloc(PCM_FRAME_BYTES * 16, 7));
    await new Promise((resolve) => setImmediate(resolve));

    for (let frame = 0; frame < 15; frame++) clock.tick();
    await Promise.resolve();
    expect(finished).toBe(false);
    clock.tick();
    await Promise.resolve();

    // No extra silent tick before the next track can start.
    expect(output.sendVoiceFrame).toHaveBeenCalledTimes(16);
    expect(finished).toBe(true);
    expect(player.state).toBe("idle");
  });

  it("pads the last partial frame with silence instead of dropping it", async () => {
    const { clock, encodeMock, player } = setup();
    const source = new PassThrough();
    let finished = false;
    void player.play(source).then(() => (finished = true));
    source.end(
      Buffer.concat([
        Buffer.alloc(PCM_FRAME_BYTES * 16, 7),
        Buffer.alloc(1_000, 9),
      ]),
    );
    await new Promise((resolve) => setImmediate(resolve));

    for (let frame = 0; frame < 17; frame++) clock.tick();
    await Promise.resolve();

    expect(encodeMock).toHaveBeenCalledTimes(17);
    const tail = encodeMock.mock.calls[16]?.[0];
    expect(tail?.byteLength).toBe(PCM_FRAME_BYTES);
    expect(tail?.[999]).toBe(9);
    expect(tail?.[1_000]).toBe(0);
    expect(finished).toBe(true);
  });

  it("meters the loudness it sends, before the volume gain", () => {
    const { clock, player } = setup();
    player.setVolume(0.5);
    const source = new PassThrough();
    void player.play(source);
    const frames = 30;
    const pcm = Buffer.alloc(PCM_FRAME_BYTES * frames);
    const amplitude = 10 ** (-23 / 20) * 32_767;
    for (let i = 0; i < (PCM_FRAME_BYTES * frames) / 4; i++) {
      const value = Math.round(
        amplitude * Math.sin((2 * Math.PI * 1_000 * i) / 48_000),
      );
      pcm.writeInt16LE(value, i * 4);
      pcm.writeInt16LE(value, i * 4 + 2);
    }
    source.write(pcm);
    for (let frame = 0; frame < frames; frame++) clock.tick();

    expect(player.metrics.delivered?.integratedLufs).toBeCloseTo(-23, 0);
  });

  it("reports its clock's tick timing with the play metrics", () => {
    const { encoder, output } = setup();
    const timing = {
      clockSlips: 2,
      latenessCounts: [40, 0, 0, 0, 0, 0, 2],
      latenessSumMs: 150,
      maxLatenessMs: 90,
      ticks: 42,
    };
    const clock = { start: vi.fn(), stop: vi.fn(), timing };

    const player = new AudioPlayer(encoder, output, clock);

    expect(player.metrics.clockTiming).toEqual(timing);
    expect(
      new AudioPlayer(encoder, output, new ManualClock()).metrics,
    ).not.toHaveProperty("clockTiming");
  });

  it("prebuffers 320ms of PCM and emits one exact frame per clock tick", () => {
    const { clock, encodeMock, output, player } = setup();
    const source = new PassThrough();
    void player.play(source);
    source.write(Buffer.alloc(PCM_FRAME_BYTES * 15, 7));
    expect(player.state).toBe("buffering");
    source.write(Buffer.alloc(PCM_FRAME_BYTES, 7));

    expect(player.state).toBe("playing");
    clock.tick();

    expect(encodeMock).toHaveBeenCalledWith(
      expect.objectContaining({ byteLength: PCM_FRAME_BYTES }),
      1,
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

  it("does not fail when pause clears the recovery timer during underrun", async () => {
    vi.useFakeTimers();
    try {
      const { clock, player } = setup();
      const source = new PassThrough();
      void player.play(source);
      source.write(Buffer.alloc(PCM_FRAME_BYTES * 25));
      for (let frame = 0; frame <= 25; frame++) clock.tick();

      player.pause();
      expect(player.state).toBe("paused");

      await vi.advanceTimersByTimeAsync(5_000);

      expect(player.state).toBe("paused");
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

  it("keeps a slow-but-alive source buffering past the stall timeout", async () => {
    vi.useFakeTimers();
    try {
      const { clock, player } = setup();
      const source = new PassThrough();
      const completion = player.play(source);

      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(14_000);
        source.write(Buffer.alloc(PCM_FRAME_BYTES * 2));
        expect(player.state).toBe("buffering");
      }

      source.end(Buffer.alloc(PCM_FRAME_BYTES));
      await vi.advanceTimersByTimeAsync(0);
      expect(player.state).toBe("playing");
      for (let frame = 0; frame <= 12; frame++) clock.tick();

      await expect(completion).resolves.toBeUndefined();
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

  it("hands the volume to the encoder instead of rounding it into the PCM", () => {
    const { clock, encodeMock, player } = setup();
    const source = new PassThrough();
    void player.play(source);
    player.setVolume(0.5);
    const frame = Buffer.alloc(PCM_FRAME_BYTES * 20);
    frame[0] = 0x10;
    frame[1] = 0x10;
    source.write(frame);
    clock.tick();

    const [pcm, gain] = encodeMock.mock.calls[0] ?? [];
    expect(pcm?.[0]).toBe(0x10);
    expect(pcm?.[1]).toBe(0x10);
    expect(gain).toBe(0.5);
  });
});

describe("AudioPlayer at a low volume", () => {
  it("keeps quiet passages clean", async () => {
    // A -45 dBFS passage at !volume 10% (-36 dB). Rounding the gained
    // samples back to int16 before encoding dropped it to about 15 dB SNR,
    // heard as robotic grit once listeners turned their client up.
    const gain = 10 ** (-36 / 20);
    const frames = 100;
    const amplitude = 10 ** (-45 / 20) * 32_767;
    const pcm = Buffer.alloc(PCM_FRAME_BYTES * frames);
    const input: number[] = [];
    for (let t = 0; t < SAMPLES_PER_CHANNEL * frames; t++) {
      const value = Math.round(
        amplitude *
          (0.6 * Math.sin((2 * Math.PI * 440 * t) / 48_000) +
            0.4 * Math.sin((2 * Math.PI * 1_320 * t) / 48_000)),
      );
      pcm.writeInt16LE(value, t * 4);
      pcm.writeInt16LE(value, t * 4 + 2);
      input.push(value);
    }
    const encoder = await createRhapsodOpusEncoder({ bitrate: 160_000 });
    const decoder = await createDecoder({ channels: 2, sampleRate: 48_000 });
    const output: number[] = [];
    const clock = new ManualClock();
    const player = new AudioPlayer(
      encoder,
      {
        sendVoiceFrame: (packet) => {
          const decoded = decoder.decodeFloat(packet, {
            frameSize: SAMPLES_PER_CHANNEL,
          });
          for (let i = 0; i < decoded.length; i += 2) {
            output.push(((decoded[i] ?? 0) * 32_768) / gain);
          }
        },
      },
      clock,
    );
    try {
      player.setVolume(gain);
      const source = new PassThrough();
      void player.play(source);
      source.end(pcm);
      await new Promise((resolve) => setImmediate(resolve));
      for (let frame = 0; frame < frames; frame++) clock.tick();
    } finally {
      encoder.close();
      decoder.free();
    }

    const delay = 312;
    let signal = 0;
    let noise = 0;
    for (let i = 20 * SAMPLES_PER_CHANNEL; i < input.length - delay; i++) {
      const reference = input[i] ?? 0;
      signal += reference ** 2;
      noise += (reference - (output[i + delay] ?? 0)) ** 2;
    }
    expect(output.length).toBe(input.length);
    expect(10 * Math.log10(signal / noise)).toBeGreaterThan(20);
  });
});

describe("isMidPlayStall", () => {
  it("matches a stall after playback started, not one while buffering", () => {
    expect(isMidPlayStall("Audio source stalled for 5000ms")).toBe(true);
    expect(
      isMidPlayStall("Audio source stalled while buffering for 15000ms"),
    ).toBe(false);
    expect(isMidPlayStall("FFmpeg exited with code 1")).toBe(false);
  });
});
