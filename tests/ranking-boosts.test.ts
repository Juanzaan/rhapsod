import { describe, expect, it } from "vitest";

import {
  applyRankingRules,
  DURATION_RULES,
  TITLE_BONUSES,
  TITLE_PENALTIES,
} from "../src/lib/ranking-boosts.js";

describe("ranking-boosts", () => {
  describe("TITLE_BONUSES", () => {
    it("awards +10 for 'official audio'", () => {
      const score = applyRankingRules(
        "song",
        "Artist - Song (Official Audio)",
        TITLE_BONUSES,
      );
      expect(score).toBeGreaterThanOrEqual(10);
    });

    it("awards +10 for 'official video'", () => {
      const score = applyRankingRules(
        "song",
        "Artist - Song (Official Video)",
        TITLE_BONUSES,
      );
      expect(score).toBeGreaterThanOrEqual(10);
    });

    it("awards +10 for 'topic'", () => {
      const score = applyRankingRules(
        "song",
        "Artist - Song (Topic)",
        TITLE_BONUSES,
      );
      expect(score).toBeGreaterThanOrEqual(10);
    });

    it("awards +5 for 'remastered' when query does not contain it", () => {
      const score = applyRankingRules(
        "song",
        "Artist - Song (Remastered 2023)",
        TITLE_BONUSES,
      );
      expect(score).toBeGreaterThanOrEqual(5);
    });

    it("does NOT award 'remastered' bonus when query contains it", () => {
      const score = applyRankingRules(
        "song remastered",
        "Artist - Song (Remastered 2023)",
        TITLE_BONUSES,
      );
      expect(score).toBe(0);
    });
  });

  describe("TITLE_PENALTIES", () => {
    it("penalizes -15 for 'instrumental' when query does not contain it", () => {
      const score = applyRankingRules(
        "song",
        "Artist - Song (Instrumental)",
        TITLE_PENALTIES,
      );
      expect(score).toBeLessThanOrEqual(-15);
    });

    it("does NOT penalize 'instrumental' when query contains it", () => {
      const score = applyRankingRules(
        "song instrumental",
        "Artist - Song (Instrumental)",
        TITLE_PENALTIES,
      );
      expect(score).toBe(0);
    });

    it("penalizes -20 for 'cover' when query does not contain it", () => {
      const score = applyRankingRules(
        "song",
        "Artist - Song (Cover)",
        TITLE_PENALTIES,
      );
      expect(score).toBeLessThanOrEqual(-20);
    });

    it("penalizes -25 for 'slowed'", () => {
      const score = applyRankingRules(
        "song",
        "Artist - Song (Slowed)",
        TITLE_PENALTIES,
      );
      expect(score).toBeLessThanOrEqual(-25);
    });

    it("penalizes -10 for 'lyric video' when query does not contain lyrics", () => {
      const score = applyRankingRules(
        "song",
        "Artist - Song (Lyric Video)",
        TITLE_PENALTIES,
      );
      expect(score).toBeLessThanOrEqual(-10);
    });

    it("does NOT penalize 'lyric video' when query contains 'lyrics'", () => {
      const score = applyRankingRules(
        "song lyrics",
        "Artist - Song (Lyric Video)",
        TITLE_PENALTIES,
      );
      expect(score).toBe(0);
    });
  });

  describe("DURATION_RULES", () => {
    it("penalizes -30 for videos longer than 30 minutes", () => {
      const score = applyRankingRules(
        "song",
        "Artist - Song",
        DURATION_RULES,
        2000,
      );
      expect(score).toBe(-30);
    });

    it("penalizes -20 for videos shorter than 45 seconds", () => {
      const score = applyRankingRules(
        "song",
        "Artist - Song",
        DURATION_RULES,
        30,
      );
      expect(score).toBe(-20);
    });

    it("does not penalize normal duration", () => {
      const score = applyRankingRules(
        "song",
        "Artist - Song",
        DURATION_RULES,
        200,
      );
      expect(score).toBe(0);
    });
  });

  describe("applyRankingRules", () => {
    it("returns 0 for no matching rules", () => {
      const score = applyRankingRules("query", "title", []);
      expect(score).toBe(0);
    });

    it("sums multiple matching rules", () => {
      const rules = [
        { term: /\bofficial\b/i, bonus: 10 },
        { term: /\bvideo\b/i, bonus: 5 },
      ];
      const score = applyRankingRules("song", "Official Video", rules);
      expect(score).toBe(15);
    });
  });
});
