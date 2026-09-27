import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { CHANNELS, SAMPLE_RATE } from "../src/audio/opus-encoder.js";
import {
  buildFfmpegPcmArguments,
  buildLoudnessFilter,
  probeFfmpegFilter,
  resolveFfmpegBinary,
  createFfmpegPcmStream,
  ffmpegEnvironment,
  isFfmpegExit,
  isForbiddenResponse,
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

  it("stops the input at the music end, on the track's own timeline", () => {
    const args = buildFfmpegPcmArguments("https://cdn.example.test/audio", {
      endSeconds: 200,
      seekSeconds: 12,
    });

    const input = args.indexOf("-i");
    expect(args.slice(0, input)).toEqual(
      expect.arrayContaining(["-ss", "12", "-to", "200"]),
    );
    expect(args.indexOf("-to")).toBeGreaterThan(args.indexOf("-ss"));
  });

  it("plays to the real end when a seek lands past the music end", () => {
    const args = buildFfmpegPcmArguments("https://cdn.example.test/audio", {
      endSeconds: 200,
      seekSeconds: 230,
    });

    expect(args).not.toContain("-to");
  });

  it("never stops a live stream at a music end", () => {
    const args = buildFfmpegPcmArguments("https://cdn.example.test/audio", {
      endSeconds: 200,
      live: true,
    });

    expect(args).not.toContain("-to");
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

  it("routes through the proxy egress when requested", () => {
    const args = buildFfmpegPcmArguments(
      "https://cdn.example.test/audio",
      { proxyUrl: "http://127.0.0.1:40000" },
      true,
    );

    const inputIndex = args.indexOf("-i");
    expect(inputIndex).toBeGreaterThan(-1);
    expect(args.indexOf("-http_proxy")).toBeLessThan(inputIndex);
    expect(args[args.indexOf("-http_proxy") + 1]).toBe(
      "http://127.0.0.1:40000",
    );
  });

  it("stays direct by default even when a proxy is configured", () => {
    const args = buildFfmpegPcmArguments("https://cdn.example.test/audio", {
      proxyUrl: "http://127.0.0.1:40000",
    });

    expect(args).not.toContain("-http_proxy");
  });

  it("omits the proxy flag when no proxy is configured", () => {
    const args = buildFfmpegPcmArguments(
      "https://cdn.example.test/audio",
      {},
      true,
    );

    expect(args).not.toContain("-http_proxy");
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
    expect(args).toContain("-reconnect");
    expect(args[args.indexOf("-reconnect_delay_max") + 1]).toBe("5");
    expect(args[args.indexOf("-rw_timeout") + 1]).toBe("8000000");
    expect(args).toContain("-timeout");
    expect(args).not.toContain("-reconnect_on_http_error");
    expect(args).not.toContain("-reconnect_max_retries");
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
      stdout: { on: vi.fn(), pipe: vi.fn(), unpipe: vi.fn() },
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

  it("retries a 403 through the proxy egress after direct retries", async () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const spawns: string[][] = [];
      const closeHandlers: Array<
        (code: number | null, signal: string | null) => void
      > = [];
      const stderrHandlers: Array<(chunk: Buffer) => void> = [];
      const child = {
        exitCode: null,
        signalCode: null,
        kill: vi.fn(() => true),
        on: vi.fn(
          (
            event: string,
            handler: (code: number | null, signal: string | null) => void,
          ) => {
            if (event === "close") closeHandlers.push(handler);
          },
        ),
        once: vi.fn(),
        stderr: {
          on: vi.fn((event: string, handler: (chunk: Buffer) => void) => {
            if (event === "data") stderrHandlers.push(handler);
          }),
        },
        stdout: { on: vi.fn(), pipe: vi.fn(), unpipe: vi.fn() },
      };
      const spawnProcess = vi.fn((...spawnArgs: [string, string[]]) => {
        spawns.push([...spawnArgs[1]]);
        return child;
      }) as never;
      const ffmpeg = createFfmpegPcmStream("https://cdn.example.test/audio", {
        binary: "ffmpeg",
        proxyUrl: "http://127.0.0.1:40000",
        spawnProcess,
      });
      ffmpeg.stream.on("error", () => {});
      const failWith403 = () => {
        stderrHandlers[stderrHandlers.length - 1]?.(
          Buffer.from("HTTP error 403 Forbidden"),
        );
        closeHandlers[closeHandlers.length - 1]?.(1, null);
      };

      expect(spawns).toHaveLength(1);
      expect(spawns[0]).not.toContain("-http_proxy");

      failWith403();
      await vi.advanceTimersByTimeAsync(1_500);
      expect(spawns).toHaveLength(2);
      expect(spawns[1]).not.toContain("-http_proxy");

      failWith403();
      await vi.advanceTimersByTimeAsync(1_500);
      expect(spawns).toHaveLength(3);
      expect(spawns[2]).not.toContain("-http_proxy");

      // After the direct retries are exhausted, the last attempt uses proxy.
      failWith403();
      await vi.advanceTimersByTimeAsync(1_500);
      expect(spawns).toHaveLength(4);
      const proxyArgs = spawns[3] ?? [];
      expect(proxyArgs).toContain("-http_proxy");
      expect(proxyArgs[proxyArgs.indexOf("-http_proxy") + 1]).toBe(
        "http://127.0.0.1:40000",
      );
      expect(proxyArgs.indexOf("-http_proxy")).toBeLessThan(
        proxyArgs.indexOf("-i"),
      );

      // A 403 on the proxy attempt ends the stream: no fifth spawn.
      failWith403();
      await vi.advanceTimersByTimeAsync(1_500);
      expect(spawns).toHaveLength(4);
      ffmpeg.stop();
    } finally {
      errorSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("cancels a pending 403 retry when stopped, so no orphan spawns", async () => {
    // A skip inside the 1.5s retry window used to leave a timer that spawned
    // a fresh ffmpeg into an ended stream with nothing left to kill it.
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const spawns: number[] = [];
      const closeHandlers: Array<
        (code: number | null, signal: string | null) => void
      > = [];
      const stderrHandlers: Array<(chunk: Buffer) => void> = [];
      const makeChild = () => ({
        exitCode: null,
        signalCode: null,
        kill: vi.fn(() => true),
        on: vi.fn(
          (
            event: string,
            handler: (code: number | null, signal: string | null) => void,
          ) => {
            if (event === "close") closeHandlers.push(handler);
          },
        ),
        once: vi.fn(),
        stderr: {
          on: vi.fn((event: string, handler: (chunk: Buffer) => void) => {
            if (event === "data") stderrHandlers.push(handler);
          }),
        },
        stdout: { on: vi.fn(), pipe: vi.fn(), unpipe: vi.fn() },
      });
      const child = makeChild();
      const spawnProcess = vi.fn(() => {
        spawns.push(1);
        return child;
      }) as never;
      const ffmpeg = createFfmpegPcmStream("https://cdn.example.test/audio", {
        binary: "ffmpeg",
        spawnProcess,
      });
      ffmpeg.stream.on("error", () => {});

      expect(spawns).toHaveLength(1);
      // 403 fires a retry on a timer...
      stderrHandlers[0]?.(Buffer.from("HTTP error 403 Forbidden"));
      closeHandlers[0]?.(1, null);
      // ...but the track is skipped before the timer fires.
      ffmpeg.stop();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(spawns).toHaveLength(1);
    } finally {
      errorSpy.mockRestore();
      vi.useRealTimers();
    }
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
        stdout: { on: vi.fn(), pipe: vi.fn(), unpipe: vi.fn() },
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

describe("FFmpeg PCM 403 retry position", () => {
  function fakeSpawn() {
    const spawns: string[][] = [];
    const closeHandlers: Array<(code: number | null, signal: null) => void> =
      [];
    const stderrHandlers: Array<(chunk: Buffer) => void> = [];
    const stdoutHandlers: Array<(chunk: Buffer) => void> = [];
    const child = {
      exitCode: null,
      signalCode: null,
      kill: vi.fn(),
      on: vi.fn((event: string, handler: (code: number | null) => void) => {
        if (event === "close") closeHandlers.push(handler);
      }),
      once: vi.fn(),
      stderr: {
        on: vi.fn((event: string, handler: (chunk: Buffer) => void) => {
          if (event === "data") stderrHandlers.push(handler);
        }),
      },
      stdout: {
        on: vi.fn((event: string, handler: (chunk: Buffer) => void) => {
          if (event === "data") stdoutHandlers.push(handler);
        }),
        pipe: vi.fn(),
        unpipe: vi.fn(),
      },
    };
    const spawnProcess = vi.fn((_binary: string, args: string[]) => {
      spawns.push([...args]);
      return child;
    }) as never;
    const emitSeconds = (seconds: number) =>
      stdoutHandlers.at(-1)?.(Buffer.alloc(48_000 * 2 * 2 * seconds));
    const failWith403 = () => {
      stderrHandlers.at(-1)?.(
        Buffer.from("Server returned 403 Forbidden (access denied)"),
      );
      closeHandlers.at(-1)?.(1, null);
    };
    return { spawns, spawnProcess, emitSeconds, failWith403 };
  }

  const seekOf = (args: string[] | undefined) =>
    args?.includes("-ss") ? args[args.indexOf("-ss") + 1] : undefined;

  it("resumes where the audio stopped instead of replaying the start", async () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const fake = fakeSpawn();
      const ffmpeg = createFfmpegPcmStream("https://cdn.example.test/audio", {
        binary: "ffmpeg",
        seekSeconds: 30,
        spawnProcess: fake.spawnProcess,
      });
      ffmpeg.stream.on("error", () => {});
      expect(seekOf(fake.spawns[0])).toBe("30");
      fake.emitSeconds(12);
      fake.failWith403();
      await vi.advanceTimersByTimeAsync(1_500);
      expect(seekOf(fake.spawns[1])).toBe("42");
      ffmpeg.stop();
    } finally {
      errorSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("rejoins live streams without seeking", async () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const fake = fakeSpawn();
      const ffmpeg = createFfmpegPcmStream("https://radio.example.test/live", {
        binary: "ffmpeg",
        live: true,
        spawnProcess: fake.spawnProcess,
      });
      ffmpeg.stream.on("error", () => {});
      fake.emitSeconds(60);
      fake.failWith403();
      await vi.advanceTimersByTimeAsync(1_500);
      expect(fake.spawns).toHaveLength(2);
      expect(seekOf(fake.spawns[1])).toBeUndefined();
      ffmpeg.stop();
    } finally {
      errorSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("does not treat URL digits as a 403", () => {
    expect(
      isForbiddenResponse(
        "Error opening input https://rr4.googlevideo.com/videoplayback?itag=140&expire=1740312403: Connection reset",
      ),
    ).toBe(false);
    expect(isForbiddenResponse("HTTP Error 403: Forbidden")).toBe(true);
    expect(
      isForbiddenResponse("Server returned 403 Forbidden (access denied)"),
    ).toBe(true);
  });
});

describe("FFmpeg network guard", () => {
  it("keeps HLS segments and nested opens on TLS so they cannot reach plain-HTTP hosts", () => {
    // Regression: a public HTTPS playlist listing http://169.254.169.254/...
    // or http://127.0.0.1:8765/... made ffmpeg fetch those internal URLs.
    const args = buildFfmpegPcmArguments("https://radio.example/live.m3u8");
    const at = args.indexOf("-protocol_whitelist");
    expect(at).toBeGreaterThan(-1);
    expect(args[at + 1]).toBe("https,tls,tcp,crypto");
    expect(at).toBeLessThan(args.indexOf("-i"));
  });

  it("allows the proxy tunnel only on the proxy egress attempt", () => {
    const options = { proxyUrl: "http://127.0.0.1:40000" };
    const direct = buildFfmpegPcmArguments("https://a.example/x", options);
    const proxied = buildFfmpegPcmArguments(
      "https://a.example/x",
      options,
      true,
    );
    expect(direct[direct.indexOf("-protocol_whitelist") + 1]).toBe(
      "https,tls,tcp,crypto",
    );
    expect(proxied[proxied.indexOf("-protocol_whitelist") + 1]).toBe(
      "https,tls,tcp,crypto,httpproxy",
    );
  });

  it("sends every connection through the egress guard when one is set", () => {
    const args = buildFfmpegPcmArguments("https://a.example/x", {
      egressProxyUrl: "http://127.0.0.1:45000",
    });
    expect(args[args.indexOf("-protocol_whitelist") + 1]).toBe(
      "https,tls,tcp,crypto,httpproxy",
    );
    expect(args[args.indexOf("-http_proxy") + 1]).toBe(
      "http://127.0.0.1:45000",
    );
    expect(args.indexOf("-http_proxy")).toBeLessThan(args.indexOf("-i"));
  });

  it("uses the WARP egress instead of the guard on the fallback attempt", () => {
    const args = buildFfmpegPcmArguments(
      "https://a.example/x",
      {
        egressProxyUrl: "http://127.0.0.1:45000",
        proxyUrl: "http://127.0.0.1:40000",
      },
      true,
    );
    expect(args.filter((arg) => arg === "-http_proxy")).toHaveLength(1);
    expect(args[args.indexOf("-http_proxy") + 1]).toBe(
      "http://127.0.0.1:40000",
    );
  });

  it("drops -timeout whenever a proxy is used", () => {
    // Regression: ffmpeg exits with "Option timeout not found" when -timeout
    // and -http_proxy are both set, so every WARP fallback attempt failed
    // before connecting.
    const warp = buildFfmpegPcmArguments(
      "https://a.example/x",
      { proxyUrl: "http://127.0.0.1:40000" },
      true,
    );
    const guarded = buildFfmpegPcmArguments("https://a.example/x", {
      egressProxyUrl: "http://127.0.0.1:45000",
    });
    const direct = buildFfmpegPcmArguments("https://a.example/x");
    expect(warp).not.toContain("-timeout");
    expect(guarded).not.toContain("-timeout");
    expect(direct).toContain("-timeout");
    expect(warp).toContain("-rw_timeout");
    expect(guarded).toContain("-rw_timeout");
  });

  it("removes no_proxy from ffmpeg's environment when the guard is on", () => {
    vi.stubEnv("no_proxy", "127.0.0.1");
    vi.stubEnv("NO_PROXY", "127.0.0.1");
    try {
      const env = ffmpegEnvironment("http://127.0.0.1:45000");
      expect(env?.no_proxy).toBeUndefined();
      expect(env?.NO_PROXY).toBeUndefined();
      expect(env?.PATH).toBe(process.env.PATH);
      expect(ffmpegEnvironment(undefined)).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("logs only abnormal exits, without the stream URL or tokens", () => {
    const writes: string[] = [];
    const writeSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        writes.push(String(chunk));
        return true;
      });
    try {
      const closeHandlers: Array<
        (code: number | null, signal: string | null) => void
      > = [];
      const stderrHandlers: Array<(chunk: Buffer) => void> = [];
      const child = {
        exitCode: null,
        signalCode: null,
        kill: vi.fn(() => true),
        on: vi.fn(
          (
            event: string,
            handler: (code: number | null, signal: string | null) => void,
          ) => {
            if (event === "close") closeHandlers.push(handler);
          },
        ),
        once: vi.fn(),
        stderr: {
          on: vi.fn((event: string, handler: (chunk: Buffer) => void) => {
            if (event === "data") stderrHandlers.push(handler);
          }),
        },
        stdout: { on: vi.fn(), pipe: vi.fn(), unpipe: vi.fn() },
      };
      const spawnProcess = vi.fn(() => child) as never;

      const finished = createFfmpegPcmStream(
        "https://rr1.googlevideo.example/videoplayback?sig=SECRETSIG",
        { spawnProcess },
      );
      closeHandlers[0]?.(0, null);
      expect(writes).toHaveLength(0);
      finished.stop();

      const failed = createFfmpegPcmStream(
        "https://rr1.googlevideo.example/videoplayback?sig=SECRETSIG",
        { spawnProcess },
      );
      failed.stream.on("error", () => {});
      stderrHandlers[stderrHandlers.length - 1]?.(
        Buffer.from(
          "https://rr1.googlevideo.example/videoplayback?sig=SECRETSIG: I/O error authorization: Bearer abc.def",
        ),
      );
      closeHandlers[closeHandlers.length - 1]?.(1, null);
      expect(writes).toHaveLength(1);
      expect(writes[0]).toContain("FFmpeg exited");
      expect(writes[0]).not.toContain("SECRETSIG");
      expect(writes[0]).not.toContain("abc.def");
    } finally {
      writeSpy.mockRestore();
    }
  });
});

describe("buildLoudnessFilter", () => {
  const wideRange = {
    measuredI: -20,
    measuredLra: 18,
    measuredThresh: -31,
    measuredTp: -3,
  };

  it("applies a measured profile as a fixed gain plus a peak limiter", () => {
    expect(
      buildLoudnessFilter({
        loudnessProfile: {
          measuredI: -9.5,
          measuredLra: 9.8,
          measuredThresh: -23.1,
          measuredTp: -0.2,
        },
        loudnessTargetLufs: -14,
        peakLimiter: true,
      }),
    ).toBe("volume=-4.50dB,alimiter=limit=0.8414:level=false");
  });

  // loudnorm linear=true drops to its dynamic mode when measured_LRA exceeds
  // LRA=11, so wide-range tracks were gain-ridden despite a profile.
  it("keeps wide-range tracks on the fixed gain", () => {
    const filter = buildLoudnessFilter({
      loudnessProfile: wideRange,
      loudnessTargetLufs: -14,
      peakLimiter: true,
    });

    expect(filter).toBe("volume=6.00dB,alimiter=limit=0.8414:level=false");
  });

  it("caps the boost for near-silent tracks", () => {
    expect(
      buildLoudnessFilter({
        loudnessProfile: { ...wideRange, measuredI: -45, measuredTp: -30 },
        loudnessTargetLufs: -14,
        peakLimiter: true,
      }),
    ).toBe("volume=12.00dB,alimiter=limit=0.8414:level=false");
  });

  it("keeps loudnorm's linear pass when alimiter is missing", () => {
    const filter = buildLoudnessFilter({
      loudnessProfile: wideRange,
      loudnessTargetLufs: -14,
      peakLimiter: false,
    });

    expect(filter).toContain("linear=true");
    expect(filter).not.toContain("alimiter");
  });

  it("does nothing when normalization is disabled", () => {
    expect(
      buildLoudnessFilter({
        loudnessProfile: wideRange,
        loudnessTargetLufs: 0,
        peakLimiter: true,
      }),
    ).toBeUndefined();
  });
});

describe("probeFfmpegFilter", () => {
  const listing = [
    "Filters:",
    "  T.. = Timeline support",
    " ------",
    " T.C alimiter          A->A       Audio lookahead limiter.",
    " ... loudnorm          A->A       EBU R128 loudness normalization",
  ].join("\n");

  it("finds a filter by its name column", async () => {
    const run = vi.fn(() => Promise.resolve({ stdout: listing }));

    await expect(probeFfmpegFilter("ffmpeg", "alimiter", run)).resolves.toBe(
      true,
    );
    expect(run).toHaveBeenCalledWith("ffmpeg", ["-hide_banner", "-filters"]);
  });

  it("does not match a name inside a description", async () => {
    const run = vi.fn(() => Promise.resolve({ stdout: listing }));

    await expect(probeFfmpegFilter("ffmpeg", "lookahead", run)).resolves.toBe(
      false,
    );
  });

  it("treats a binary that fails to run as missing the filter", async () => {
    const run = vi.fn(() => Promise.reject(new Error("ENOENT")));

    await expect(probeFfmpegFilter("ffmpeg", "alimiter", run)).resolves.toBe(
      false,
    );
  });

  const bundled = resolveFfmpegBinary(undefined);
  it.skipIf(!existsSync(bundled))(
    "keeps a boosted track under the ceiling with the real binary",
    async () => {
      await expect(probeFfmpegFilter(bundled, "alimiter")).resolves.toBe(true);
      // A 0.9 amplitude sine boosted by 6 dB would hit full scale; the
      // limiter holds it near the -1.5 dBFS ceiling.
      const filter = buildLoudnessFilter({
        loudnessProfile: {
          measuredI: -20,
          measuredLra: 1,
          measuredThresh: -30,
          measuredTp: -1,
        },
        loudnessTargetLufs: -14,
        peakLimiter: true,
      });
      const pcm = execFileSync(bundled, [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "aevalsrc=0.9*sin(2*PI*440*t):d=2",
        "-af",
        filter!,
        "-f",
        "s16le",
        "-ac",
        "1",
        "pipe:1",
      ]);
      let peak = 0;
      for (let i = 0; i + 1 < pcm.length; i += 2) {
        peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)));
      }
      expect(peak / 32768).toBeLessThanOrEqual(0.85);
      expect(peak / 32768).toBeGreaterThan(0.8);
    },
    15_000,
  );
});

describe("isFfmpegExit", () => {
  it("matches the error the PCM stream raises when ffmpeg dies", () => {
    expect(isFfmpegExit("FFmpeg exited with code 1: Connection reset")).toBe(
      true,
    );
    expect(isFfmpegExit("Audio source stalled for 5000ms")).toBe(false);
  });
});
