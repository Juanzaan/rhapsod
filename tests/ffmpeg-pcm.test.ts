import { describe, expect, it, vi } from "vitest";

import { CHANNELS, SAMPLE_RATE } from "../src/audio/opus-encoder.js";
import {
  buildFfmpegPcmArguments,
  createFfmpegPcmStream,
} from "../src/audio/ffmpeg-pcm.js";

describe("FFmpeg PCM source", () => {
  it("requests raw stereo PCM in the Rhapsod audio format", () => {
    const args = buildFfmpegPcmArguments("https://cdn.example.test/audio");

    expect(args).toContain("-reconnect");
    expect(args).not.toContain("-reconnect_at_eof");
    expect(args).toContain("-rw_timeout");
    expect(args).toContain("-vn");
    expect(args).toContain("-f");
    expect(args).toContain("s16le");
    expect(args).toContain(String(SAMPLE_RATE));
    expect(args).toContain(String(CHANNELS));
    expect(args.at(-1)).toBe("pipe:1");
  });

  it("applies loudness normalization when a target is configured", () => {
    const args = buildFfmpegPcmArguments("https://cdn.example.test/audio", {
      loudnessTargetLufs: -14,
    });

    expect(args).toContain("-af");
    expect(args).toContain("loudnorm=I=-14:TP=-1.5:LRA=11");
  });

  it("skips loudness normalization when disabled", () => {
    const args = buildFfmpegPcmArguments("https://cdn.example.test/audio", {
      loudnessTargetLufs: 0,
    });

    expect(args).not.toContain("-af");
    expect(args).not.toContain("loudnorm");
  });

  it("sends a custom User-Agent before the input URL when configured", () => {
    const args = buildFfmpegPcmArguments("https://cdn.example.test/audio", {
      userAgent: "Rhapsod/1.0",
    });

    const inputIndex = args.indexOf("-i");
    expect(inputIndex).toBeGreaterThan(-1);
    expect(args.indexOf("-user_agent")).toBeLessThan(inputIndex);
    expect(args[args.indexOf("-user_agent") + 1]).toBe("Rhapsod/1.0");
  });

  it("omits the User-Agent flag when none is configured", () => {
    const args = buildFfmpegPcmArguments("https://cdn.example.test/audio");

    expect(args).not.toContain("-user_agent");
  });

  it("seeks the input when a start offset is configured", () => {
    const args = buildFfmpegPcmArguments("https://cdn.example.test/audio", {
      seekSeconds: 42,
    });

    const inputIndex = args.indexOf("-i");
    expect(inputIndex).toBeGreaterThan(-1);
    expect(args.indexOf("-ss")).toBeLessThan(inputIndex);
    expect(args[args.indexOf("-ss") + 1]).toBe("42");
  });

  it("omits the seek flag when the offset is zero", () => {
    const args = buildFfmpegPcmArguments("https://cdn.example.test/audio", {
      seekSeconds: 0,
    });

    expect(args).not.toContain("-ss");
  });

  it("limits the input probe so playback starts sooner", () => {
    const args = buildFfmpegPcmArguments("https://cdn.example.test/audio");

    const inputIndex = args.indexOf("-i");
    expect(inputIndex).toBeGreaterThan(-1);
    expect(args.indexOf("-analyzeduration")).toBeLessThan(inputIndex);
    expect(args.indexOf("-probesize")).toBeLessThan(inputIndex);
    expect(args[args.indexOf("-analyzeduration") + 1]).toBe("1M");
    expect(args[args.indexOf("-probesize") + 1]).toBe("1M");
  });

  it("rejects non-HTTPS inputs", () => {
    expect(() => buildFfmpegPcmArguments("http://example.test/audio")).toThrow(
      "must use HTTPS",
    );
  });

  it("passes playback options to the spawned FFmpeg process", () => {
    const child = {
      exitCode: null,
      signalCode: null,
      kill: vi.fn(() => true),
      on: vi.fn(),
      once: vi.fn(),
      stderr: { on: vi.fn() },
      stdout: { pipe: vi.fn(), unpipe: vi.fn() },
    };
    const spawnProcess = vi.fn((...spawnArgs: [string, readonly string[]]) => {
      void spawnArgs;
      return child;
    });

    const ffmpeg = createFfmpegPcmStream("https://cdn.example.test/audio", {
      binary: "ffmpeg",
      loudnessTargetLufs: -14,
      seekSeconds: 42,
      spawnProcess: spawnProcess as never,
      userAgent: "Rhapsod/1.0",
    });

    const args = spawnProcess.mock.calls[0]?.[1] as readonly string[];
    expect(args).toContain("-af");
    expect(args).toContain("loudnorm=I=-14:TP=-1.5:LRA=11");
    expect(args).toContain("-ss");
    expect(args).toContain("42");
    expect(args).toContain("-user_agent");
    expect(args).toContain("Rhapsod/1.0");
    ffmpeg.stop();
  });

  it("escalates to SIGKILL when SIGTERM does not stop the process", async () => {
    vi.useFakeTimers();
    try {
      const killCalls: string[] = [];
      const child = {
        exitCode: null,
        signalCode: null,
        kill: vi.fn((signal: string) => {
          killCalls.push(signal);
          return true;
        }),
        on: vi.fn(),
        once: vi.fn(),
        stderr: { on: vi.fn() },
        stdout: { pipe: vi.fn(), unpipe: vi.fn() },
      };
      const spawnProcess = vi.fn(() => child) as never;
      const ffmpeg = createFfmpegPcmStream("https://cdn.example.test/audio", {
        binary: "ffmpeg",
        spawnProcess,
      });
      ffmpeg.stream.destroy();

      ffmpeg.stop();
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");

      await vi.advanceTimersByTimeAsync(3_001);
      expect(killCalls).toContain("SIGKILL");
    } finally {
      vi.useRealTimers();
    }
  });
});
