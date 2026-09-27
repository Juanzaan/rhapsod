import { execFileSync, spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { GatedLoudness, LoudnessMeter } from "../src/audio/loudness-meter.js";

const RATE = 48_000;

function stereo(seconds: number, sample: (t: number) => number): Uint8Array {
  const frames = Math.round(seconds * RATE);
  const pcm = new Uint8Array(frames * 4);
  const view = new DataView(pcm.buffer);
  for (let i = 0; i < frames; i++) {
    const value = Math.round(sample(i / RATE) * 32_767);
    view.setInt16(i * 4, value, true);
    view.setInt16(i * 4 + 2, value, true);
  }
  return pcm;
}

function feed(meter: LoudnessMeter, pcm: Uint8Array): void {
  // In 20 ms frames, as the player sends them.
  for (let offset = 0; offset < pcm.byteLength; offset += 3_840) {
    meter.add(pcm.subarray(offset, offset + 3_840));
  }
}

function hasFfmpeg(): boolean {
  return spawnSync("ffmpeg", ["-version"]).status === 0;
}

describe("LoudnessMeter", () => {
  it("reads a -23 dBFS stereo 1 kHz sine as -23 LUFS (EBU Tech 3341 case 1)", () => {
    const meter = new LoudnessMeter();
    const amplitude = 10 ** (-23 / 20);
    feed(
      meter,
      stereo(5, (t) => amplitude * Math.sin(2 * Math.PI * 1_000 * t)),
    );
    expect(meter.result.integratedLufs).toBeCloseTo(-23, 1);
  });

  it("finds a true peak between samples", () => {
    // A quarter-rate sine shifted 45 degrees never lands a sample on its
    // crest: samples reach 0.354 (-9 dBFS), the waveform 0.5 (-6 dBFS).
    const meter = new LoudnessMeter();
    feed(
      meter,
      stereo(1, (t) => 0.5 * Math.sin(2 * Math.PI * 12_000 * t + Math.PI / 4)),
    );
    expect(meter.result.truePeakDbtp).toBeGreaterThan(-6.6);
    expect(meter.result.truePeakDbtp).toBeLessThan(-5.6);
  });

  it("gates quiet passages out of the integrated loudness", () => {
    const meter = new LoudnessMeter();
    const loud = 10 ** (-23 / 20);
    const quiet = 10 ** (-60 / 20);
    feed(
      meter,
      stereo(
        10,
        (t) => (t < 5 ? loud : quiet) * Math.sin(2 * Math.PI * 1_000 * t),
      ),
    );
    expect(meter.result.integratedLufs).toBeCloseTo(-23, 0);
  });

  it("reports nothing for silence", () => {
    const meter = new LoudnessMeter();
    feed(
      meter,
      stereo(2, () => 0),
    );
    expect(meter.result).toEqual({});
  });

  it.skipIf(!hasFfmpeg())("agrees with ffmpeg's ebur128 on pink noise", () => {
    const pcm = execFileSync(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "anoisesrc=color=pink:amplitude=0.3:duration=8:seed=7",
        "-ac",
        "2",
        "-ar",
        "48000",
        "-f",
        "s16le",
        "-",
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    const report = spawnSync(
      "ffmpeg",
      [
        "-hide_banner",
        "-nostats",
        "-f",
        "s16le",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-i",
        "-",
        "-af",
        "ebur128=peak=true",
        "-f",
        "null",
        "-",
      ],
      { input: pcm, maxBuffer: 16 * 1024 * 1024 },
    ).stderr.toString();
    const summary = report.slice(report.lastIndexOf("Summary:"));
    const expectedI = Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1]);
    const expectedTp = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1]);

    const meter = new LoudnessMeter();
    feed(meter, new Uint8Array(pcm));
    expect(Math.abs(meter.result.integratedLufs! - expectedI)).toBeLessThan(
      0.2,
    );
    expect(Math.abs(meter.result.truePeakDbtp! - expectedTp)).toBeLessThan(0.3);
  });
});

describe("GatedLoudness", () => {
  const loudness = (power: number): number => -0.691 + 10 * Math.log10(power);
  const exact = (powers: readonly number[]): number => {
    const mean = (values: readonly number[]): number =>
      values.reduce((sum, value) => sum + value, 0) / values.length;
    const absolute = powers.filter((power) => loudness(power) > -70);
    const threshold = loudness(mean(absolute)) - 10;
    return loudness(mean(absolute.filter((p) => loudness(p) > threshold)));
  };

  it("gates like the exact per-block calculation", () => {
    let seed = 7;
    const random = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    // Block levels spread from -80 to 0 LUFS, so both gates cut something.
    const powers = Array.from(
      { length: 5_000 },
      () => 10 ** ((-80 + 80 * random() + 0.691) / 10),
    );
    const gated = new GatedLoudness();
    for (const power of powers) gated.add(power);

    expect(Math.abs(gated.integrated()! - exact(powers))).toBeLessThan(0.05);
  });

  it("keeps a reading cheap after days of blocks", () => {
    // A day of a radio stream is 864,000 blocks of 400 ms every 100 ms. The
    // previous meter kept each one and rescanned them all on every read.
    const gated = new GatedLoudness();
    const power = 10 ** ((-14 + 0.691) / 10);
    for (let block = 0; block < 1_000_000; block++) gated.add(power);

    const started = performance.now();
    for (let read = 0; read < 100; read++) gated.integrated();
    const perRead = (performance.now() - started) / 100;

    expect(gated.integrated()).toBeCloseTo(-14, 1);
    expect(perRead).toBeLessThan(2);
  });
});
