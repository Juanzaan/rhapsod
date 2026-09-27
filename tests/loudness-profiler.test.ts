import { execFile as execFileCallback, spawnSync } from "node:child_process";
import { promisify } from "node:util";

import { describe, expect, it, vi } from "vitest";

import { LoudnessProfiler } from "../src/audio/loudness-profiler.js";

// What ffmpeg 6.1 prints for the pass-1 command: the report goes to stderr
// at info level, after the stream banner, with every value as a string.
const FFMPEG_STDERR = `Input #0, mov,m4a,mp4, from 'https://media.example/abc':
  Duration: 00:03:12.45, start: 0.000000, bitrate: 129 kb/s
  Stream #0:0[0x1](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 128 kb/s (default)
Stream mapping:
  Stream #0:0 -> #0:0 (aac (native) -> pcm_s16le (native))
Output #0, null, to 'pipe:':
  Stream #0:0(und): Audio: pcm_s16le, 192000 Hz, stereo, s16, 6144 kb/s (default)
[Parsed_loudnorm_0 @ 0x55d0c1e4c7c0]
{
\t"input_i" : "-13.42",
\t"input_tp" : "-1.11",
\t"input_lra" : "9.80",
\t"input_thresh" : "-23.10",
\t"output_i" : "-14.02",
\t"output_tp" : "-1.50",
\t"output_lra" : "8.70",
\t"output_thresh" : "-23.68",
\t"normalization_type" : "dynamic",
\t"target_offset" : "0.02"
}
`;
const MEASURED = { stderr: FFMPEG_STDERR, stdout: "" };

// 130 s of a quiet tone, then 20 s at nearly full scale (sine starts at 1/8).
const QUIET_INTRO_LOUD_CHORUS =
  "sine=frequency=440:duration=150,volume='if(lt(t,130),0.4,7.2)':eval=frame";

function hasFfmpeg(): boolean {
  return spawnSync("ffmpeg", ["-version"]).status === 0;
}

describe("LoudnessProfiler", () => {
  it("caches a profile measured from ffmpeg loudnorm pass 1", async () => {
    const execFile = vi.fn(() => Promise.resolve(MEASURED));
    const profiler = new LoudnessProfiler({ execFile });
    profiler.measure("https://youtu.be/abc", "https://media.example/abc", 200);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const profile = profiler.cached("https://youtu.be/abc");
    expect(profile).toBeDefined();
    expect(profile?.measuredI).toBeCloseTo(-13.42);
    expect(profile?.measuredTp).toBeCloseTo(-1.11);
    expect(profile?.measuredLra).toBeCloseTo(9.8);
    expect(profile?.measuredThresh).toBeCloseTo(-23.1);
    expect(execFile).toHaveBeenCalledWith(
      "ffmpeg",
      expect.arrayContaining([
        "-protocol_whitelist",
        "https,tls,tcp,crypto",
        "-i",
        "https://media.example/abc",
        "-af",
        "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json",
      ]),
      expect.objectContaining({ timeout: 180_000 }),
    );
  });

  it("asks ffmpeg for the info-level report and ignores silent input", async () => {
    // With -loglevel error ffmpeg never printed the report, so no profile
    // was ever cached and every track fell back to single-pass loudnorm.
    const silent = FFMPEG_STDERR.replace('"-13.42"', '"-inf"');
    const execFile = vi.fn(() =>
      Promise.resolve({ stderr: silent, stdout: "" }),
    );
    const profiler = new LoudnessProfiler({ execFile });
    profiler.measure("https://youtu.be/abc", "https://media.example/abc", 200);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const args = (execFile.mock.calls[0] as unknown[] | undefined)?.[1];
    expect(args).toEqual(expect.arrayContaining(["-loglevel", "info"]));
    expect(args).not.toContain("error");
    expect(profiler.cached("https://youtu.be/abc")).toBeUndefined();
  });

  it.skipIf(!hasFfmpeg())(
    "measures the whole track with the real ffmpeg binary",
    async () => {
      // Same arguments as production, with the network input swapped for a
      // generated tone: this is what the fixture above stands in for.
      const execFile = (
        file: string,
        args: readonly string[],
        options: { maxBuffer: number; timeout: number; windowsHide: boolean },
      ): Promise<{ stderr: string; stdout: string }> => {
        const local: string[] = [];
        for (let i = 0; i < args.length; i++) {
          if (args[i] === "-protocol_whitelist") i++;
          else if (args[i] === "-i") {
            local.push("-f", "lavfi", "-i", QUIET_INTRO_LOUD_CHORUS);
            i++;
          } else local.push(args[i]!);
        }
        return promisify(execFileCallback)(file, local, options);
      };
      const profiler = new LoudnessProfiler({ execFile });
      profiler.measure(
        "https://youtu.be/tone",
        "https://media.example/tone",
        150,
      );
      await vi.waitFor(
        () => expect(profiler.cached("https://youtu.be/tone")).toBeDefined(),
        { timeout: 10_000 },
      );
      // The true peak must come from the chorus: with only the first 120 s
      // measured, linear gain sized for the intro clipped 74% of the
      // chorus samples.
      expect(
        profiler.cached("https://youtu.be/tone")?.measuredTp,
      ).toBeGreaterThan(-3);
    },
    15_000,
  );

  it("measures whole tracks and leaves long ones to the dynamic filter", async () => {
    const execFile = vi.fn(() => Promise.resolve(MEASURED));
    const profiler = new LoudnessProfiler({ execFile });
    profiler.measure(
      "https://youtu.be/mix",
      "https://media.example/mix",
      3_600,
    );
    profiler.measure("https://youtu.be/abc", "https://media.example/abc", 200);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(execFile).toHaveBeenCalledTimes(1);
    expect(
      (execFile.mock.calls[0] as unknown[] | undefined)?.[1],
    ).not.toContain("-t");
    expect(profiler.cached("https://youtu.be/mix")).toBeUndefined();
  });

  it("returns undefined for an unmeasured source", () => {
    const profiler = new LoudnessProfiler();
    expect(profiler.cached("https://youtu.be/unknown")).toBeUndefined();
  });

  it("does not re-measure a source that already has a profile", async () => {
    const execFile = vi.fn(() => Promise.resolve(MEASURED));
    const profiler = new LoudnessProfiler({ execFile });
    profiler.measure("https://youtu.be/abc", "https://media.example/abc", 200);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(execFile).toHaveBeenCalledTimes(1);

    profiler.measure("https://youtu.be/abc", "https://media.example/abc", 200);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(execFile).toHaveBeenCalledTimes(1);
  });

  it("does not cache a profile when ffmpeg fails", async () => {
    const execFile = vi.fn(() => Promise.reject(new Error("network down")));
    const profiler = new LoudnessProfiler({ execFile });
    profiler.measure("https://youtu.be/abc", "https://media.example/abc", 200);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(profiler.cached("https://youtu.be/abc")).toBeUndefined();
  });

  it("measures through the egress guard when one is set", async () => {
    const execFile = vi.fn(() => Promise.resolve(MEASURED));
    const profiler = new LoudnessProfiler({
      execFile,
      egressProxyUrl: "http://127.0.0.1:45000",
    });
    profiler.measure("https://youtu.be/abc", "https://media.example/abc", 200);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(execFile).toHaveBeenCalledWith(
      "ffmpeg",
      expect.arrayContaining([
        "-protocol_whitelist",
        "https,tls,tcp,crypto,httpproxy",
        "-http_proxy",
        "http://127.0.0.1:45000",
      ]),
      expect.objectContaining({ env: expect.any(Object) as unknown }),
    );
  });
});
