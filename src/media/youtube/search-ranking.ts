import type { YoutubeSearchCandidate } from "./yt-dlp.js";

const PENALIZED_TERMS =
  /\b(8d|acoustic|arena|bass boost(ed)?|clean|concert|cover|demo|edited|extended|festival|instrumental|karaoke|live|mashup|nightcore|radio|reaction|rehearsal|remix|reverb|review|session|shorts?|slowed|sped up|stadium|tour)\b/i;
const MINOR_PENALIZED_TERMS = /\blyrics?\b/i;
const LIVE_EVENT_CONTEXT =
  /\([^)]*\b(at|live|festival|tour|concert|session|stadium|arena|radio|acoustic)\b[^)]*\)/i;
const POSITIVE_TERMS =
  /\b(official audio|official video|topic|provided to youtube)\b/i;
const CHANNEL_MATCH_BONUS = 12;
const MAX_CHANNEL_MATCH_BONUS = 24;
const FUZZY_MIN_TERM_LENGTH = 4;
const DURATION_TOLERANCE = 0.25;
const DURATION_MISMATCH_PENALTY = 40;
const VERSION_PENALTY = 35;
const MINOR_VERSION_PENALTY = 10;

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
  const normalizedQuery = normalize(query);
  return candidates
    .map((candidate) => ({
      candidate,
      score: scoreCandidate(
        query,
        normalizedQuery,
        candidate,
        expectedDurationSeconds,
      ),
    }))
    .filter((item) => item.score >= 35)
    .sort((left, right) => right.score - left.score)
    .map((item) => item.candidate);
}

function scoreCandidate(
  query: string,
  normalizedQuery: string,
  candidate: YoutubeSearchCandidate,
  expectedDurationSeconds?: number,
): number {
  const title = normalize(candidate.title);
  const queryTerms = normalizedQuery.split(" ").filter(Boolean);
  const titleTerms = title.split(" ").filter(Boolean);
  const matchingTerms = queryTerms.filter((term) =>
    titleTerms.some((titleTerm) => termMatches(term, titleTerm)),
  ).length;
  let score = queryTerms.length ? (matchingTerms / queryTerms.length) * 45 : 0;
  if (title === normalizedQuery) score += 25;
  if (POSITIVE_TERMS.test(candidate.title)) score += 10;
  if (
    candidate.channel &&
    /topic|official|records|music/i.test(candidate.channel)
  )
    score += 8;
  if (candidate.channel) {
    const channelTerms = normalize(candidate.channel)
      .split(" ")
      .filter(Boolean);
    const channelMatches = queryTerms.filter((term) =>
      channelTerms.some((channelTerm) => termMatches(term, channelTerm)),
    ).length;
    score += Math.min(
      channelMatches * CHANNEL_MATCH_BONUS,
      MAX_CHANNEL_MATCH_BONUS,
    );
  }
  if (
    candidate.liveStatus === "is_live" ||
    candidate.liveStatus === "is_upcoming"
  )
    score -= 30;
  if (
    PENALIZED_TERMS.test(candidate.title) &&
    !PENALIZED_TERMS.test(normalizedQuery)
  )
    score -= VERSION_PENALTY;
  if (
    MINOR_PENALIZED_TERMS.test(candidate.title) &&
    !MINOR_PENALIZED_TERMS.test(normalizedQuery)
  )
    score -= MINOR_VERSION_PENALTY;
  if (
    LIVE_EVENT_CONTEXT.test(candidate.title) &&
    !LIVE_EVENT_CONTEXT.test(query)
  )
    score -= VERSION_PENALTY;
  if (candidate.durationSeconds !== undefined && candidate.durationSeconds < 45)
    score -= 20;
  if (
    expectedDurationSeconds !== undefined &&
    candidate.durationSeconds !== undefined &&
    expectedDurationSeconds > 0
  ) {
    const deviation =
      Math.abs(candidate.durationSeconds - expectedDurationSeconds) /
      expectedDurationSeconds;
    if (deviation > DURATION_TOLERANCE) score -= DURATION_MISMATCH_PENALTY;
  }
  return score;
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
