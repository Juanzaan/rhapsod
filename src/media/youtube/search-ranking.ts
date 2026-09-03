import type { YoutubeSearchCandidate } from "./yt-dlp.js";
import {
  applyRankingRules,
  TITLE_BONUSES,
  TITLE_PENALTIES,
  DURATION_RULES,
} from "../../lib/ranking-boosts.js";

const MINOR_PENALIZED_TERMS = /\blyrics?\b/i;
const LIVE_EVENT_CONTEXT =
  /\([^)]*\b(at|live|festival|tour|concert|session|stadium|arena|radio|acoustic)\b[^)]*\)/i;
const STOPWORD_TERMS =
  /\b(o|or|y|and|de|del|la|el|los|las|un|una|the|of|official|audio|lyrics?|letra|video|oficial|version|full)\b/i;
const MEDIAN_DURATION_BONUS = 10;
const CHANNEL_MATCH_BONUS = 12;
const MAX_CHANNEL_MATCH_BONUS = 24;
const FUZZY_MIN_TERM_LENGTH = 3;
const FUZZY_MAX_DISTANCE_SHORT = 1;
const FUZZY_MAX_DISTANCE_LONG = 2;
const DURATION_TOLERANCE = 0.25;
const DURATION_MISMATCH_PENALTY = 40;
const VERSION_PENALTY = 35;
const MINOR_VERSION_PENALTY = 10;
const TITLE_LENGTH_PENALTY = 12;
const VERIFIED_CHANNEL_BONUS = 12;
const VIEW_COUNT_LOG_BONUS = 8;
const MIN_DURATION_FOR_median = 60;

export interface ScoredCandidate {
  readonly candidate: YoutubeSearchCandidate;
  readonly score: number;
  readonly breakdown: Record<string, number>;
}

export function rankYoutubeCandidates(
  query: string,
  candidates: readonly YoutubeSearchCandidate[],
  expectedDurationSeconds?: number,
): YoutubeSearchCandidate | undefined {
  return rankYoutubeCandidatesAll(
    query,
    candidates,
    expectedDurationSeconds,
  )[0];
}

export function rankYoutubeCandidatesAll(
  query: string,
  candidates: readonly YoutubeSearchCandidate[],
  expectedDurationSeconds?: number,
): YoutubeSearchCandidate[] {
  return rankYoutubeCandidatesScored(
    query,
    candidates,
    expectedDurationSeconds,
  ).map((item) => item.candidate);
}

export function rankYoutubeCandidatesScored(
  query: string,
  candidates: readonly YoutubeSearchCandidate[],
  expectedDurationSeconds?: number,
  expectedTitle?: string,
): ScoredCandidate[] {
  const normalizedQuery = normalize(query);
  const normalizedExpectedTitle = expectedTitle
    ? normalize(expectedTitle)
    : undefined;
  const medianDuration = expectedDurationSeconds ?? median(candidates);
  const maxViews = maxViewCount(candidates);
  return candidates
    .map((candidate) => {
      const { score, breakdown } = scoreCandidate(
        query,
        normalizedQuery,
        candidate,
        expectedDurationSeconds,
        medianDuration,
        normalizedExpectedTitle,
        maxViews,
      );
      return { candidate, score, breakdown };
    })
    .filter((item) => item.score >= 35)
    .sort((left, right) => right.score - left.score);
}

function scoreCandidate(
  query: string,
  normalizedQuery: string,
  candidate: YoutubeSearchCandidate,
  expectedDurationSeconds?: number,
  medianDurationSeconds?: number,
  normalizedExpectedTitle?: string,
  maxViews?: number,
): { score: number; breakdown: Record<string, number> } {
  const title = normalize(candidate.title);
  const rawQueryTerms = normalizedQuery
    .split(" ")
    .filter((term) => term.length > 0 && !STOPWORD_TERMS.test(term));
  // When artist is extracted (e.g. "my bad bro fimiguerrero" -> artist "fimiguerrero"),
  // don't penalize titles that omit the artist (e.g. "my bad bro" channel fimiguerrero).
  // Use title part only for termMatch, artist handled via channelMatch/expectedTitleMatch.
  let queryTerms = rawQueryTerms;
  if (normalizedExpectedTitle) {
    const artistTermsForFilter = normalizedExpectedTitle
      .split(" ")
      .filter(Boolean);
    const filtered = rawQueryTerms.filter(
      (term) =>
        !artistTermsForFilter.some(
          (a) => termMatches(a, term) || termMatches(term, a),
        ),
    );
    if (filtered.length > 0) queryTerms = filtered;
  }
  const titleTerms = title.split(" ").filter(Boolean);
  const matchingTerms = queryTerms.filter((term) =>
    titleTerms.some((titleTerm) => termMatches(term, titleTerm)),
  ).length;
  const breakdown: Record<string, number> = {};
  let score = queryTerms.length ? (matchingTerms / queryTerms.length) * 45 : 0;
  breakdown.termMatch = score;
  if (normalizedExpectedTitle) {
    const artistTerms = normalizedExpectedTitle.split(" ").filter(Boolean);
    const allArtistTermsMatchTitle = artistTerms.every((artistTerm) =>
      titleTerms.some((titleTerm) => termMatches(artistTerm, titleTerm)),
    );
    const channelNorm = candidate.channel ? normalize(candidate.channel) : "";
    const channelTermsForArtist = channelNorm.split(" ").filter(Boolean);
    const allArtistTermsMatchChannel = artistTerms.every((artistTerm) =>
      channelTermsForArtist.some((ch) => termMatches(artistTerm, ch)),
    );
    if (
      artistTerms.length > 0 &&
      (title.includes(normalizedExpectedTitle) ||
        allArtistTermsMatchTitle ||
        allArtistTermsMatchChannel)
    ) {
      score += 30;
      breakdown.expectedTitleMatch = 30;
    }
  }
  if (title === normalizedQuery) {
    score += 25;
    breakdown.exactTitle = 25;
  }
  const titleBonuses = applyRankingRules(
    query,
    candidate.title,
    TITLE_BONUSES,
    candidate.durationSeconds,
  );
  if (titleBonuses !== 0) {
    score += titleBonuses;
    breakdown.titleBonuses = titleBonuses;
  }
  if (
    candidate.channel &&
    /topic|official|records|music/i.test(candidate.channel)
  ) {
    score += 8;
    breakdown.officialChannel = 8;
  }
  if (candidate.channelVerified) {
    score += VERIFIED_CHANNEL_BONUS;
    breakdown.verifiedChannel = VERIFIED_CHANNEL_BONUS;
  }
  if (candidate.channel) {
    const channelTerms = normalize(candidate.channel)
      .split(" ")
      .filter(Boolean);
    // Use raw terms for channel matching so artist in channel still counts
    // even when we filtered it from title termMatch
    const channelMatches = rawQueryTerms.filter((term) =>
      channelTerms.some((channelTerm) => termMatches(term, channelTerm)),
    ).length;
    const channelBonus = Math.min(
      channelMatches * CHANNEL_MATCH_BONUS,
      MAX_CHANNEL_MATCH_BONUS,
    );
    if (channelBonus > 0) {
      score += channelBonus;
      breakdown.channelMatch = channelBonus;
    }
  }
  if (candidate.viewCount !== undefined && candidate.viewCount > 0) {
    const viewBonus = maxViews
      ? Math.round(
          (candidate.viewCount / maxViews) * VIEW_COUNT_LOG_BONUS * 10,
        ) / 10
      : 0;
    if (viewBonus > 0) {
      score += viewBonus;
      breakdown.viewCount = viewBonus;
    }
  }
  if (
    candidate.liveStatus === "is_live" ||
    candidate.liveStatus === "is_upcoming"
  ) {
    score -= 30;
    breakdown.livePenalty = -30;
  }
  const titlePenalties = applyRankingRules(
    query,
    candidate.title,
    TITLE_PENALTIES,
    candidate.durationSeconds,
  );
  if (titlePenalties !== 0) {
    score += titlePenalties;
    breakdown.titlePenalties = titlePenalties;
  }
  if (
    MINOR_PENALIZED_TERMS.test(candidate.title) &&
    !MINOR_PENALIZED_TERMS.test(normalizedQuery)
  ) {
    // For single-term queries like "poland", lyric videos are often the only
    // music result - penalize less to avoid filtering them out entirely.
    const penalty = queryTerms.length === 1 ? 3 : MINOR_VERSION_PENALTY;
    score -= penalty;
    breakdown.minorVersionPenalty = -penalty;
  }
  if (
    LIVE_EVENT_CONTEXT.test(candidate.title) &&
    !LIVE_EVENT_CONTEXT.test(query)
  ) {
    score -= VERSION_PENALTY;
    breakdown.liveEventPenalty = -VERSION_PENALTY;
  }
  // Penalize overly long titles for short queries (e.g. documentaries for "poland")
  // Original issue: "Nazi invasion of Poland | James Holland and Lex Fridman" won over music
  if (queryTerms.length <= 2 && titleTerms.length > queryTerms.length * 4 + 4) {
    score -= TITLE_LENGTH_PENALTY;
    breakdown.titleLengthPenalty = -TITLE_LENGTH_PENALTY;
  }
  const durationRules = applyRankingRules(
    query,
    candidate.title,
    DURATION_RULES,
    candidate.durationSeconds,
  );
  if (durationRules !== 0) {
    score += durationRules;
    breakdown.durationRules = durationRules;
  }
  if (
    expectedDurationSeconds !== undefined &&
    candidate.durationSeconds !== undefined &&
    expectedDurationSeconds > 0
  ) {
    const deviation =
      Math.abs(candidate.durationSeconds - expectedDurationSeconds) /
      expectedDurationSeconds;
    if (deviation > DURATION_TOLERANCE) {
      score -= DURATION_MISMATCH_PENALTY;
      breakdown.durationMismatch = -DURATION_MISMATCH_PENALTY;
    }
  } else if (
    medianDurationSeconds !== undefined &&
    medianDurationSeconds > 0 &&
    candidate.durationSeconds !== undefined
  ) {
    const deviation =
      Math.abs(candidate.durationSeconds - medianDurationSeconds) /
      medianDurationSeconds;
    if (deviation <= DURATION_TOLERANCE) {
      score += MEDIAN_DURATION_BONUS;
      breakdown.medianDurationBonus = MEDIAN_DURATION_BONUS;
    }
  }
  return { score, breakdown };
}

function maxViewCount(
  candidates: readonly YoutubeSearchCandidate[],
): number | undefined {
  const views = candidates
    .map((c) => c.viewCount)
    .filter((v): v is number => v !== undefined && v > 0);
  if (views.length === 0) return undefined;
  return Math.max(...views);
}

function median(
  candidates: readonly YoutubeSearchCandidate[],
): number | undefined {
  const durations = candidates
    .map((candidate) => candidate.durationSeconds)
    .filter(
      (duration): duration is number =>
        duration !== undefined && duration >= MIN_DURATION_FOR_median,
    );
  if (durations.length === 0) return undefined;
  const sorted = [...durations].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

function termMatches(queryTerm: string, candidateTerm: string): boolean {
  if (candidateTerm.includes(queryTerm) || queryTerm.includes(candidateTerm))
    return true;
  if (queryTerm.length < FUZZY_MIN_TERM_LENGTH) return false;
  const maxDistance =
    queryTerm.length >= 6 ? FUZZY_MAX_DISTANCE_LONG : FUZZY_MAX_DISTANCE_SHORT;
  return levenshteinDistance(queryTerm, candidateTerm) <= maxDistance;
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) return 0;
  const m = left.length;
  const n = right.length;
  if (Math.abs(m - n) > 2) return 3;
  // DP limited to 2 edits - small strings so full DP is cheap
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array.from({ length: n + 1 }, () => 0),
  );
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = left.charAt(i - 1) === right.charAt(j - 1) ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      );
      // Transposition (Damerau) for amarni vs armani swap
      if (
        i > 1 &&
        j > 1 &&
        left.charAt(i - 1) === right.charAt(j - 2) &&
        left.charAt(i - 2) === right.charAt(j - 1)
      ) {
        dp[i]![j] = Math.min(dp[i]![j]!, dp[i - 2]![j - 2]! + 1);
      }
    }
  }
  return dp[m]![n]!;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
