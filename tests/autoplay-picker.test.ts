import { describe, expect, it } from "vitest";

import {
  AUTOPLAY_REQUESTER,
  AUTOPLAY_UID,
  pickAutoplayTrack,
  tokenizeTitle,
  type AutoplayCandidate,
  type AutoplayProfile,
} from "../src/application/autoplay-picker.js";

function candidate(
  id: string,
  title: string,
  artist?: string,
): AutoplayCandidate {
  return {
    ...(artist === undefined ? {} : { artist }),
    id,
    source: `https://www.youtube.com/watch?v=${id}`,
    title,
  };
}

function profile(
  artists: Record<string, number>,
  tokens: Record<string, number> = {},
): AutoplayProfile {
  return {
    artistScores: new Map(Object.entries(artists)),
    tokenScores: new Map(Object.entries(tokens)),
  };
}

describe("tokenizeTitle", () => {
  it("lowercases, strips accents and drops stopwords", () => {
    expect(tokenizeTitle("Duki - Música de la Noche")).toEqual([
      "duki",
      "musica",
      "noche",
    ]);
    expect(tokenizeTitle("a / the (Official Video)")).toEqual([
      "official",
      "video",
    ]);
  });
});

describe("pickAutoplayTrack", () => {
  it("prefers known artists over provider rank", () => {
    const picks = pickAutoplayTrack(
      [
        candidate("aaa11111111", "Unknown One"),
        candidate("bbb22222222", "Duki Mix", "Duki"),
      ],
      profile({ duki: 5 }),
      new Set(),
      [],
      undefined,
      () => 0.99,
    );

    expect(picks?.id).toBe("bbb22222222");
  });

  it("falls back to provider rank without profile signal", () => {
    const picks = pickAutoplayTrack(
      [
        candidate("aaa11111111", "First Song"),
        candidate("bbb22222222", "Second Song"),
      ],
      profile({}),
      new Set(),
      [],
      undefined,
      () => 0.99,
    );

    expect(picks?.id).toBe("aaa11111111");
  });

  it("explores randomly below the explore rate", () => {
    const picks = pickAutoplayTrack(
      [
        candidate("aaa11111111", "Duki Song", "Duki"),
        candidate("bbb22222222", "Beto Song", "Beto"),
      ],
      profile({ beto: 100 }),
      new Set(),
      [],
      undefined,
      () => 0.01,
    );

    expect(picks?.id).toBe("aaa11111111");
  });

  it("bridges from the last track for fluid transitions", () => {
    const picks = pickAutoplayTrack(
      [
        candidate("aaa11111111", "Hardstyle Banger", "DJ Furious"),
        candidate("bbb22222222", "Midnight Acoustic", "Calm Guitar"),
      ],
      profile({}),
      new Set(),
      [],
      { artist: "Calm Guitar", title: "Evening Acoustic" },
      () => 0.99,
    );

    expect(picks?.id).toBe("bbb22222222");
  });

  it("rewards token overlap with the taste profile", () => {
    const picks = pickAutoplayTrack(
      [
        candidate("aaa11111111", "Totally Random Words Here"),
        candidate("bbb22222222", "Rockstar Nights"),
      ],
      profile({}, { nights: 2, rockstar: 2 }),
      new Set(),
      [],
      undefined,
      () => 0.99,
    );

    expect(picks?.id).toBe("bbb22222222");
  });

  it("vetoes repeats and overplayed artists", () => {
    expect(
      pickAutoplayTrack(
        [candidate("aaa11111111", "Duki Song", "Duki")],
        profile({ duki: 100 }),
        new Set(["aaa11111111"]),
        [],
        undefined,
        () => 0.99,
      ),
    ).toBeUndefined();

    expect(
      pickAutoplayTrack(
        [candidate("bbb22222222", "Duki Song", "Duki")],
        profile({}),
        new Set(),
        ["Duki", "duki"],
        undefined,
        () => 0.99,
      ),
    ).toBeUndefined();
  });

  it("returns undefined for an empty pool", () => {
    expect(
      pickAutoplayTrack([], profile({}), new Set(), [], undefined, () => 0.99),
    ).toBeUndefined();
  });

  it("exposes stable autoplay identity constants", () => {
    expect(AUTOPLAY_REQUESTER).toBe("Autoplay");
    expect(AUTOPLAY_UID).toBe("autoplay");
  });
});
