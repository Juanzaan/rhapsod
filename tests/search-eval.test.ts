import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  evaluateSearch,
  formatSearchEval,
  type SearchEvalFixture,
} from "../src/media/youtube/search-eval.js";

const fixture = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "fixtures", "search-eval.json"),
    "utf8",
  ),
) as SearchEvalFixture;

describe("search evaluation fixture", () => {
  it("keeps ranking accuracy at or above the recorded minimum", () => {
    const result = evaluateSearch(fixture.cases);
    // The report lands in the test output when this fails, naming each miss.
    expect(result.accuracy, formatSearchEval(result)).toBeGreaterThanOrEqual(
      fixture.minAccuracy,
    );
  });

  it("has at least 50 well-formed cases", () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(50);
    for (const entry of fixture.cases) {
      const ids = entry.candidates.map((candidate) => candidate.id);
      expect(entry.expected.length, entry.query).toBeGreaterThan(0);
      for (const expected of entry.expected) {
        expect(ids, entry.query).toContain(expected);
      }
      expect(["recorded", "synthetic"]).toContain(entry.source);
    }
  });
});

describe("evaluateSearch", () => {
  const candidate = (id: string, title: string, durationSeconds = 200) => ({
    durationSeconds,
    id,
    title,
    webpageUrl: `https://www.youtube.com/watch?v=${id}`,
  });

  it("counts a pick in the expected set and reports misses", () => {
    const result = evaluateSearch([
      {
        candidates: [
          candidate("cover", "Artist Song (cover)"),
          candidate("official", "Artist - Song (Official Video)"),
        ],
        expected: ["official"],
        query: "artist song",
        source: "synthetic",
      },
      {
        candidates: [candidate("wrong", "Podcast about something else")],
        expected: ["missing"],
        note: "nothing relevant",
        query: "artist other song",
        source: "synthetic",
      },
    ]);
    expect(result).toMatchObject({ accuracy: 50, passed: 1, total: 2 });
    expect(result.failures[0]).toMatchObject({
      expected: ["missing"],
      query: "artist other song",
    });
    expect(formatSearchEval(result)).toContain(
      'MISS "artist other song": expected missing, got nothing [nothing relevant]',
    );
  });
});
