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
    expect(args).toContain("-vn");
    expect(args).toContain("-f");
    expect(args).toContain("s16le");
    expect(args).toContain(String(SAMPLE_RATE));
    expect(args).toContain(String(CHANNELS));
    expect(args.at(-1)).toBe("pipe:1");
  });

  it("rejects non-HTTPS inputs", () => {
    expect(() => buildFfmpegPcmArguments("http://example.test/audio")).toThrow(
      "must use HTTPS",
    );
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
