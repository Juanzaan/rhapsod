import { describe, expect, it, vi } from "vitest";

import { LoudnessProfiler } from "../src/audio/loudness-profiler.js";

const MEASURED_JSON = `{
  "input_i": -13.42,
  "input_tp": -1.11,
  "input_lra": 9.8,
  "input_thresh": -23.1,
  "target_offset": 0.42,
  "normalized_i": -14.0
}`;

describe("LoudnessProfiler", () => {
  it("caches a profile measured from ffmpeg loudnorm pass 1", async () => {
    const execFile = vi.fn(() => Promise.resolve({ stdout: MEASURED_JSON }));
    const profiler = new LoudnessProfiler({ execFile });
    profiler.measure("https://youtu.be/abc", "https://media.example/abc");
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
        "-i",
        "https://media.example/abc",
        "-af",
        "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json",
      ]),
      expect.objectContaining({ timeout: 90_000 }),
    );
  });

  it("returns undefined for an unmeasured source", () => {
    const profiler = new LoudnessProfiler();
    expect(profiler.cached("https://youtu.be/unknown")).toBeUndefined();
  });

  it("does not re-measure a source that already has a profile", async () => {
    const execFile = vi.fn(() => Promise.resolve({ stdout: MEASURED_JSON }));
    const profiler = new LoudnessProfiler({ execFile });
    profiler.measure("https://youtu.be/abc", "https://media.example/abc");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(execFile).toHaveBeenCalledTimes(1);

    profiler.measure("https://youtu.be/abc", "https://media.example/abc");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(execFile).toHaveBeenCalledTimes(1);
  });

  it("does not cache a profile when ffmpeg fails", async () => {
    const execFile = vi.fn(() => Promise.reject(new Error("network down")));
    const profiler = new LoudnessProfiler({ execFile });
    profiler.measure("https://youtu.be/abc", "https://media.example/abc");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(profiler.cached("https://youtu.be/abc")).toBeUndefined();
  });
});
