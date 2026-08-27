import { describe, expect, it } from "vitest";

import { buildFilterChain, isAudioFilter } from "../src/audio/filter-chain.js";
import {
  buildFfmpegPcmArguments,
  type FfmpegPcmOptions,
} from "../src/audio/ffmpeg-pcm.js";

describe("isAudioFilter", () => {
  it("accepts known filters and rejects others", () => {
    expect(isAudioFilter("off")).toBe(true);
    expect(isAudioFilter("bassboost")).toBe(true);
    expect(isAudioFilter("8d")).toBe(true);
    expect(isAudioFilter("unknown")).toBe(false);
    expect(isAudioFilter(5)).toBe(false);
    expect(isAudioFilter(undefined)).toBe(false);
  });
});

describe("buildFilterChain", () => {
  it("returns undefined for off", () => {
    expect(buildFilterChain("off")).toBeUndefined();
  });

  it("builds bassboost with the default level and clamped explicit levels", () => {
    expect(buildFilterChain("bassboost")).toBe("bass=g=6:f=110:w=0.6");
    expect(buildFilterChain("bassboost", { level: 1 })).toBe(
      "bass=g=4:f=110:w=0.6",
    );
    expect(buildFilterChain("bassboost", { level: 5 })).toBe(
      "bass=g=15:f=110:w=0.6",
    );
    expect(buildFilterChain("bassboost", { level: 99 })).toBe(
      "bass=g=15:f=110:w=0.6",
    );
    expect(buildFilterChain("bassboost", { level: -3 })).toBe(
      "bass=g=4:f=110:w=0.6",
    );
  });

  it("builds nightcore with the default rate and clamped explicit rates", () => {
    expect(buildFilterChain("nightcore")).toBe(
      "asetrate=55200,aresample=48000",
    );
    expect(buildFilterChain("nightcore", { rate: 1.25 })).toBe(
      "asetrate=60000,aresample=48000",
    );
    expect(buildFilterChain("nightcore", { rate: 3 })).toBe(
      "asetrate=64800,aresample=48000",
    );
  });

  it("builds vaporwave with aecho and clamped rate", () => {
    expect(buildFilterChain("vaporwave")).toBe(
      "asetrate=40800,aresample=48000,aecho=0.8:0.85:60|120:0.4|0.25",
    );
    expect(buildFilterChain("vaporwave", { rate: 0.9 })).toBe(
      "asetrate=43200,aresample=48000,aecho=0.8:0.85:60|120:0.4|0.25",
    );
  });

  it("builds 8d with a fixed autopanner", () => {
    expect(buildFilterChain("8d")).toBe("apulsator=hz=0.125:width=1");
  });

  it("treats non-finite bassboost levels as the default", () => {
    expect(buildFilterChain("bassboost", { level: NaN })).toBe(
      "bass=g=6:f=110:w=0.6",
    );
    expect(
      buildFilterChain("bassboost", { level: Number.POSITIVE_INFINITY }),
    ).toBe("bass=g=6:f=110:w=0.6");
    expect(
      buildFilterChain("bassboost", { level: Number.NEGATIVE_INFINITY }),
    ).toBe("bass=g=6:f=110:w=0.6");
  });

  it("treats non-finite nightcore rates as the default", () => {
    expect(buildFilterChain("nightcore", { rate: NaN })).toBe(
      "asetrate=55200,aresample=48000",
    );
    expect(
      buildFilterChain("nightcore", { rate: Number.POSITIVE_INFINITY }),
    ).toBe("asetrate=55200,aresample=48000");
    expect(
      buildFilterChain("nightcore", { rate: Number.NEGATIVE_INFINITY }),
    ).toBe("asetrate=55200,aresample=48000");
  });

  it("treats non-finite vaporwave rates as the default", () => {
    expect(buildFilterChain("vaporwave", { rate: NaN })).toBe(
      "asetrate=40800,aresample=48000,aecho=0.8:0.85:60|120:0.4|0.25",
    );
    expect(
      buildFilterChain("vaporwave", { rate: Number.POSITIVE_INFINITY }),
    ).toBe("asetrate=40800,aresample=48000,aecho=0.8:0.85:60|120:0.4|0.25");
    expect(
      buildFilterChain("vaporwave", { rate: Number.NEGATIVE_INFINITY }),
    ).toBe("asetrate=40800,aresample=48000,aecho=0.8:0.85:60|120:0.4|0.25");
  });
});

describe("buildFfmpegPcmArguments filter composition", () => {
  function af(options: FfmpegPcmOptions): string | undefined {
    const args = buildFfmpegPcmArguments(
      "https://media.example/audio",
      options,
    );
    const index = args.indexOf("-af");
    return index === -1 ? undefined : args[index + 1];
  }

  it("keeps loudnorm only when the filter is off", () => {
    expect(af({ loudnessTargetLufs: -14, audioFilter: { name: "off" } })).toBe(
      "loudnorm=I=-14:TP=-1.5:LRA=11",
    );
  });

  it("composes loudnorm -> effect -> alimiter", () => {
    expect(
      af({ loudnessTargetLufs: -14, audioFilter: { name: "bassboost" } }),
    ).toBe(
      "loudnorm=I=-14:TP=-1.5:LRA=11,bass=g=6:f=110:w=0.6,alimiter=limit=0.95",
    );
  });

  it("applies alimiter without loudnorm when loudness is disabled", () => {
    expect(af({ loudnessTargetLufs: 0, audioFilter: { name: "8d" } })).toBe(
      "apulsator=hz=0.125:width=1,alimiter=limit=0.95",
    );
  });

  it("emits no -af when filter is off and loudness is disabled", () => {
    expect(af({ loudnessTargetLufs: 0 })).toBeUndefined();
  });
});
