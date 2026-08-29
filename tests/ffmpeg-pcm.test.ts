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

  it("applies measured loudness with linear=true when a profile is provided", () => {
    const args = buildFfmpegPcmArguments("https://cdn.example.test/audio", {
      loudnessProfile: {
        measuredI: -13.42,
        measuredLra: 9.8,
        measuredThresh: -23.1,
        measuredTp: -1.11,
      },
      loudnessTargetLufs: -14,
    });

    const afIndex = args.indexOf("-af");
    expect(afIndex).toBeGreaterThan(-1);
    const filter = args[afIndex + 1];
    expect(filter).toContain("measured_I=-13.42");
    expect(filter).toContain("measured_TP=-1.11");
    expect(filter).toContain("measured_LRA=9.8");
    expect(filter).toContain("measured_thresh=-23.1");
    expect(filter).toContain("linear=true");
    expect(filter).toContain("I=-14");
  });

  it("falls back to the single-pass filter without a profile", () => {
    const args = buildFfmpegPcmArguments("https://cdn.example.test/audio", {
      loudnessTargetLufs: -14,
    });

    const afIndex = args.indexOf("-af");
    expect(afIndex).toBeGreaterThan(-1);
    const filter = args[afIndex + 1];
    expect(filter).toContain("loudnorm=I=-14");
    expect(filter).not.toContain("linear=true");
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
    expect(args.indexOf("-fflags")).toBeLessThan(inputIndex);
    expect(args[args.indexOf("-fflags") + 1]).toBe("+nobuffer");
    expect(args.indexOf("-flags")).toBeLessThan(inputIndex);
    expect(args[args.indexOf("-flags") + 1]).toBe("+low_delay");
    expect(args.indexOf("-analyzeduration")).toBeLessThan(inputIndex);
    expect(args.indexOf("-probesize")).toBeLessThan(inputIndex);
    expect(args[args.indexOf("-analyzeduration") + 1]).toBe("0");
    expect(args[args.indexOf("-probesize") + 1]).toBe("327680");
  });

  it("reconnects on 5xx but not on 4xx stale URLs", () => {
    const args = buildFfmpegPcmArguments("https://cdn.example.test/audio");
    expect(args[args.indexOf("-reconnect_on_http_error") + 1]).toBe("5xx");
    expect(args).toContain("-reconnect_on_network_error");
    expect(args[args.indexOf("-reconnect_delay_max") + 1]).toBe("5");
    expect(args[args.indexOf("-reconnect_max_retries") + 1]).toBe("3");
    expect(args[args.indexOf("-rw_timeout") + 1]).toBe("8000000");
    expect(args).toContain("-timeout");
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
