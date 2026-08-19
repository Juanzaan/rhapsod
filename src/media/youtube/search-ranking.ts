import type { YoutubeSearchCandidate } from "./yt-dlp.js";

const PENALIZED_TERMS =
  /\b(cover|live|remix|reaction|review|shorts?|sped up|slowed|nightcore|karaoke)\b/i;
const POSITIVE_TERMS =
  /\b(official audio|official video|topic|provided to youtube)\b/i;
const CHANNEL_MATCH_BONUS = 12;
const MAX_CHANNEL_MATCH_BONUS = 24;
const FUZZY_MIN_TERM_LENGTH = 4;

export function rankYoutubeCandidates(
  query: string,
  candidates: readonly YoutubeSearchCandidate[],
): YoutubeSearchCandidate | undefined {
  return rankYoutubeCandidatesAll(query, candidates)[0];
}

export function rankYoutubeCandidatesAll(
  query: string,
  candidates: readonly YoutubeSearchCandidate[],
): YoutubeSearchCandidate[] {
  const normalizedQuery = normalize(query);
  return candidates
    .map((candidate) => ({
      candidate,
      score: scoreCandidate(normalizedQuery, candidate),
    }))
    .filter((item) => item.score >= 35)
    .sort((left, right) => right.score - left.score)
    .map((item) => item.candidate);
}

function scoreCandidate(
  normalizedQuery: string,
  candidate: YoutubeSearchCandidate,
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
    score -= 35;
  if (candidate.durationSeconds !== undefined && candidate.durationSeconds < 45)
    score -= 20;
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
