import { describe, expect, it } from "vitest";

import {
  AUTOPLAY_REQUESTER,
  AUTOPLAY_UID,
  pickAutoplayTrack,
  type AutoplayCandidate,
  type AutoplayProfile,
} from "../src/application/autoplay-picker.js";

function candidate(
  id: string,
  artist?: string,
): AutoplayCandidate & { artist?: string } {
  return {
    ...(artist === undefined ? {} : { artist }),
    id,
    source: `https://www.youtube.com/watch?v=${id}`,
    title: `Track ${id}`,
  };
}

function profile(scores: Record<string, number>): AutoplayProfile {
  return { artistScores: () => new Map(Object.entries(scores)) };
}

describe("pickAutoplayTrack", () => {
  it("prefers known artists over provider rank", () => {
    const picks = pickAutoplayTrack(
      [candidate("aaa11111111", "Unknown"), candidate("bbb22222222", "Duki")],
      profile({ duki: 5 }),
      new Set(),
      [],
      () => 0.99,
    );

    expect(picks?.id).toBe("bbb22222222");
  });

  it("falls back to provider rank without profile signal", () => {
    const picks = pickAutoplayTrack(
      [candidate("aaa11111111"), candidate("bbb22222222")],
      profile({}),
      new Set(),
      [],
      () => 0.99,
    );

    expect(picks?.id).toBe("aaa11111111");
  });

  it("explores randomly below the explore rate", () => {
    const picks = pickAutoplayTrack(
      [candidate("aaa11111111", "Duki"), candidate("bbb22222222", "Beto")],
      profile({ beto: 100 }),
      new Set(),
      [],
      () => 0.01,
    );

    expect(picks?.id).toBe("aaa11111111");
  });

  it("vetoes repeats and overplayed artists", () => {
    expect(
      pickAutoplayTrack(
        [candidate("aaa11111111", "Duki")],
        profile({ duki: 100 }),
        new Set(["aaa11111111"]),
        [],
        () => 0.99,
      ),
    ).toBeUndefined();

    expect(
      pickAutoplayTrack(
        [candidate("bbb22222222", "Duki")],
        profile({}),
        new Set(),
        ["Duki", "duki"],
        () => 0.99,
      ),
    ).toBeUndefined();
  });

  it("returns undefined for an empty pool", () => {
    expect(
      pickAutoplayTrack([], profile({}), new Set(), [], () => 0.99),
    ).toBeUndefined();
  });

  it("exposes stable autoplay identity constants", () => {
    expect(AUTOPLAY_REQUESTER).toBe("Autoplay");
    expect(AUTOPLAY_UID).toBe("autoplay");
  });
});
