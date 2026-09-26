import { rankYoutubeCandidatesScored } from "./search-ranking.js";
import type { YoutubeSearchCandidate } from "./yt-dlp.js";

/**
 * One query with the candidate list the ranker saw and the acceptable
 * picks. "recorded" cases come from `npm run eval:search -- --record`
 * against live YouTube; "synthetic" ones are written by hand to pin a
 * pattern (cover vs official, live vs studio, sped-up edits...).
 */
export interface SearchEvalCase {
  readonly query: string;
  /** Candidate ids that count as a correct pick. */
  readonly expected: readonly string[];
  readonly source: "recorded" | "synthetic";
  readonly note?: string;
  readonly expectedDurationSeconds?: number;
  readonly expectedTitle?: string;
  readonly candidates: readonly YoutubeSearchCandidate[];
}

export interface SearchEvalFixture {
  /** Accuracy the suite must keep; raise it when ranking improves. */
  readonly minAccuracy: number;
  readonly cases: readonly SearchEvalCase[];
}

export interface SearchEvalFailure {
  readonly query: string;
  readonly expected: readonly string[];
  readonly picked?: string;
  readonly pickedTitle?: string;
  readonly note?: string;
}

export interface SearchEvalResult {
  readonly total: number;
  readonly passed: number;
  readonly accuracy: number;
  readonly failures: readonly SearchEvalFailure[];
}

export function evaluateSearch(
  cases: readonly SearchEvalCase[],
): SearchEvalResult {
  const failures: SearchEvalFailure[] = [];
  for (const entry of cases) {
    const top = rankYoutubeCandidatesScored(
      entry.query,
      entry.candidates,
      entry.expectedDurationSeconds,
      entry.expectedTitle,
    )[0]?.candidate;
    if (top !== undefined && entry.expected.includes(top.id)) continue;
    failures.push({
      expected: entry.expected,
      query: entry.query,
      ...(top === undefined ? {} : { picked: top.id, pickedTitle: top.title }),
      ...(entry.note === undefined ? {} : { note: entry.note }),
    });
  }
  const passed = cases.length - failures.length;
  return {
    accuracy:
      cases.length === 0 ? 0 : Math.round((passed / cases.length) * 1_000) / 10,
    failures,
    passed,
    total: cases.length,
  };
}

export function formatSearchEval(result: SearchEvalResult): string {
  const lines = [
    `Search evaluation: ${result.passed}/${result.total} correct (${result.accuracy}%)`,
  ];
  for (const failure of result.failures) {
    lines.push(
      `  MISS "${failure.query}": expected ${failure.expected.join(" or ")}, got ${
        failure.picked === undefined
          ? "nothing"
          : `${failure.picked} (${failure.pickedTitle ?? ""})`
      }${failure.note === undefined ? "" : ` [${failure.note}]`}`,
    );
  }
  return lines.join("\n");
}
