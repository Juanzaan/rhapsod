import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  formatAutoplayEval,
  runAutoplayEval,
  seededRandom,
  type AutoplayEvalFixture,
} from "../src/application/autoplay-eval.js";

const fixture = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "fixtures", "autoplay-eval.json"),
    "utf8",
  ),
) as AutoplayEvalFixture;

describe("autoplay evaluation fixture", () => {
  it.each([1, 2, 3])(
    "keeps the DJ within the recorded limits (seed %i)",
    async (seed) => {
      const report = await runAutoplayEval(fixture, seed);
      const detail = formatAutoplayEval(report);
      expect(report.ranDry, detail).toBe(false);
      expect(report.picks, detail).toHaveLength(fixture.turns);
      expect(report.repeats, detail).toBeLessThanOrEqual(
        fixture.limits.maxRepeats,
      );
      expect(report.maxArtistShare, detail).toBeLessThanOrEqual(
        fixture.limits.maxArtistShare,
      );
      expect(report.meanEnergyJump, detail).toBeLessThanOrEqual(
        fixture.limits.maxMeanEnergyJump,
      );
      expect(report.newShare, detail).toBeGreaterThanOrEqual(
        fixture.limits.minNewShare,
      );
    },
  );
});

describe("runAutoplayEval", () => {
  const dryFixture: AutoplayEvalFixture = {
    history: [],
    limits: {
      maxArtistShare: 1,
      maxMeanEnergyJump: 1,
      maxRepeats: 0,
      minNewShare: 0,
    },
    seedId: "seed0000001",
    tracks: [
      {
        durationSeconds: 200,
        id: "seed0000001",
        mix: ["seed0000001", "next0000001"],
        title: "Artist - Seed",
      },
      {
        durationSeconds: 200,
        id: "next0000001",
        mix: ["next0000001", "seed0000001"],
        title: "Other - Next",
      },
    ],
    turns: 5,
  };

  it("reports running dry when the mixes offer nothing new", async () => {
    const report = await runAutoplayEval(dryFixture);
    expect(report.picks.map((pick) => pick.id)).toEqual(["next0000001"]);
    expect(report.ranDry).toBe(true);
  });

  it("detects running dry quickly with coarse timers", async () => {
    // Windows fires timers every ~16 ms; the tick-counted wait took ~8 s
    // there and hit vitest's 5 s timeout.
    const original = globalThis.setTimeout;
    const coarse = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation((handler: () => void, ms?: number) =>
        original(handler, Math.max(ms ?? 0, 16)),
      );
    try {
      const startedAt = Date.now();
      const report = await runAutoplayEval(dryFixture);
      expect(report.ranDry).toBe(true);
      expect(Date.now() - startedAt).toBeLessThan(3_000);
    } finally {
      coarse.mockRestore();
    }
  });

  it("uses a reproducible random sequence per seed", () => {
    const first = seededRandom(7);
    const second = seededRandom(7);
    const values = [first(), first(), first()];
    expect([second(), second(), second()]).toEqual(values);
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
  });
});
