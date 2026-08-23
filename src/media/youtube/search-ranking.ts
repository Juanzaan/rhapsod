import type { YoutubeSearchCandidate } from "./yt-dlp.js";

const PENALIZED_TERMS =
  /\b(8d|acoustic|arena|bass boost(ed)?|clean|concert|cover|demo|edited|extended|festival|instrumental|karaoke|live|mashup|nightcore|radio|reaction|rehearsal|remix|reverb|review|session|shorts?|slowed|sped up|stadium|tour)\b/i;
const MINOR_PENALIZED_TERMS = /\blyrics?\b/i;
const LIVE_EVENT_CONTEXT =
  /\([^)]*\b(at|live|festival|tour|concert|session|stadium|arena|radio|acoustic)\b[^)]*\)/i;
const AUDIO_TERMS =
  /\b(official audio|official video|topic|provided to youtube|visualizer)\b/i;
const LYRIC_VIDEO = /\blyric video\b/i;
const STOPWORD_TERMS =
  /\b(o|or|y|and|de|del|la|el|los|las|un|una|the|of|official|audio|lyrics?|letra|video|oficial|version|full)\b/i;
const MEDIAN_DURATION_BONUS = 10;
const CHANNEL_MATCH_BONUS = 12;
const MAX_CHANNEL_MATCH_BONUS = 24;
const FUZZY_MIN_TERM_LENGTH = 4;
const DURATION_TOLERANCE = 0.25;
const DURATION_MISMATCH_PENALTY = 40;
const VERSION_PENALTY = 35;
const MINOR_VERSION_PENALTY = 10;
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
  return candidates
    .map((candidate) => {
      const { score, breakdown } = scoreCandidate(
        query,
        normalizedQuery,
        candidate,
        expectedDurationSeconds,
        medianDuration,
        normalizedExpectedTitle,
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
): { score: number; breakdown: Record<string, number> } {
  const title = normalize(candidate.title);
  const queryTerms = normalizedQuery
    .split(" ")
    .filter((term) => term.length > 0 && !STOPWORD_TERMS.test(term));
  const titleTerms = title.split(" ").filter(Boolean);
  const matchingTerms = queryTerms.filter((term) =>
    titleTerms.some((titleTerm) => termMatches(term, titleTerm)),
  ).length;
  const breakdown: Record<string, number> = {};
  let score = queryTerms.length ? (matchingTerms / queryTerms.length) * 45 : 0;
  breakdown.termMatch = score;
  if (normalizedExpectedTitle && title.includes(normalizedExpectedTitle)) {
    score += 30;
    breakdown.expectedTitleMatch = 30;
  }
  if (title === normalizedQuery) {
    score += 25;
    breakdown.exactTitle = 25;
  }
  if (AUDIO_TERMS.test(candidate.title)) {
    score += 10;
    breakdown.audioTerms = 10;
  }
  if (LYRIC_VIDEO.test(candidate.title) && /\blyrics?\b/i.test(query)) {
    score += 10;
    breakdown.lyricVideoBonus = 10;
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
    const channelMatches = queryTerms.filter((term) =>
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
    const logViews = Math.log10(candidate.viewCount);
    const viewBonus = Math.min(
      Math.round((logViews / 10) * VIEW_COUNT_LOG_BONUS * 10) / 10,
      VIEW_COUNT_LOG_BONUS,
    );
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
  if (
    PENALIZED_TERMS.test(candidate.title) &&
    !PENALIZED_TERMS.test(normalizedQuery)
  ) {
    score -= VERSION_PENALTY;
    breakdown.versionPenalty = -VERSION_PENALTY;
  }
  if (
    MINOR_PENALIZED_TERMS.test(candidate.title) &&
    !MINOR_PENALIZED_TERMS.test(normalizedQuery)
  ) {
    score -= MINOR_VERSION_PENALTY;
    breakdown.minorVersionPenalty = -MINOR_VERSION_PENALTY;
  }
  if (
    LIVE_EVENT_CONTEXT.test(candidate.title) &&
    !LIVE_EVENT_CONTEXT.test(query)
  ) {
    score -= VERSION_PENALTY;
    breakdown.liveEventPenalty = -VERSION_PENALTY;
  }
  if (
    candidate.durationSeconds !== undefined &&
    candidate.durationSeconds < 45
  ) {
    score -= 20;
    breakdown.shortPenalty = -20;
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
  return levenshteinDistance(queryTerm, candidateTerm) <= 1;
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) return 0;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  if (longer.length === shorter.length) {
    let differences = 0;
    for (let i = 0; i < shorter.length; i++) {
      if (shorter.charAt(i) !== longer.charAt(i)) differences++;
      if (differences > 1) return 2;
    }
    return differences;
  }
  if (longer.length - shorter.length > 1) return 2;
  let offset = 0;
  for (let i = 0; i < shorter.length; i++) {
    if (shorter.charAt(i) !== longer.charAt(i + offset)) {
      offset++;
      if (offset > 1) return 2;
      if (shorter.charAt(i) !== longer.charAt(i + offset)) return 2;
    }
  }
  return 1;
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
