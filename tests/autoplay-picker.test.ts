import { describe, expect, it } from "vitest";

import {
  AUTOPLAY_ROTATION,
  autoplayBucketOrder,
  weightedPick,
  AUTOPLAY_REQUESTER,
  AUTOPLAY_UID,
  energyOfTitle,
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

describe("energyOfTitle", () => {
  it("scores energetic, calm and neutral titles", () => {
    expect(energyOfTitle("Midnight Club Remix")).toBeGreaterThan(0.5);
    expect(energyOfTitle("Soft Piano Morning")).toBeLessThan(-0.5);
    expect(energyOfTitle("Duki - Rockstar")).toBe(0);
    expect(energyOfTitle("Acoustic Club Night")).toBeCloseTo(0, 5);
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

  it("prefers same energy over the same name", () => {
    const last = { artist: "Calm Guitar", title: "Evening Acoustic" };
    const picks = pickAutoplayTrack(
      [
        candidate("aaa11111111", "Club Remix", "Calm Guitar"),
        candidate("bbb22222222", "Soft Piano Morning", "Other Artist"),
      ],
      profile({}),
      new Set(),
      [],
      last,
      () => 0.99,
    );

    expect(picks?.id).toBe("bbb22222222");
  });

  it("rotates artists with a soft penalty instead of locking on", () => {
    const starters: [string, string][] = [
      ["aaa11111111", "X Song"],
      ["bbb22222222", "Y Song"],
    ];
    const fresh = (recent: string[]): string | undefined =>
      pickAutoplayTrack(
        starters.map(([id, title]) =>
          candidate(id, title, id === "aaa11111111" ? "X Band" : "Y Band"),
        ),
        profile({ "x band": 1.9, "y band": 2.0 }),
        new Set(),
        recent,
        undefined,
        () => 0.99,
      )?.id;

    expect(fresh([])).toBe("aaa11111111");
    expect(fresh(["X Band"])).toBe("bbb22222222");
  });

  it("bounds exploration to compatible energy", () => {
    const last = { artist: "Calm Guitar", title: "Evening Acoustic" };
    const picks = pickAutoplayTrack(
      [
        candidate("aaa11111111", "Club Remix", "DJ A"),
        candidate("bbb22222222", "Hardstyle Night", "DJ B"),
        candidate("ccc33333333", "Soft Piano Morning", "Other Artist"),
      ],
      profile({}),
      new Set(),
      [],
      last,
      () => 0.01,
    );

    expect(picks?.id).toBe("ccc33333333");
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

describe("autoplay DJ rotation", () => {
  it("rotates similar, classic and discovery picks 4/3/3", () => {
    const counts = new Map<string, number>();
    for (let turn = 0; turn < AUTOPLAY_ROTATION.length; turn++) {
      const bucket = autoplayBucketOrder(turn, new Map())[0]!;
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    }
    expect(Object.fromEntries(counts)).toEqual({
      similar: 4,
      classic: 3,
      discover: 3,
    });
    for (let turn = 1; turn < AUTOPLAY_ROTATION.length; turn++) {
      expect(AUTOPLAY_ROTATION[turn]).not.toBe(AUTOPLAY_ROTATION[turn - 1]);
    }
  });

  it("moves a just-skipped bucket to the back without dropping it", () => {
    expect(autoplayBucketOrder(1, new Map([["classic", 2]]))).toEqual([
      "similar",
      "discover",
      "classic",
    ]);
  });

  it("draws weighted entries and never returns undefined for a pool", () => {
    const pool = [
      { id: "a", score: 9 },
      { id: "b", score: 1 },
    ];
    expect(
      weightedPick(
        pool,
        (e) => e.score,
        () => 0,
      )?.id,
    ).toBe("a");
    expect(
      weightedPick(
        pool,
        (e) => e.score,
        () => 0.95,
      )?.id,
    ).toBe("b");
    expect(weightedPick([], () => 1)).toBeUndefined();
  });
});
