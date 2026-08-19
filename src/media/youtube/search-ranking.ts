import type { YoutubeSearchCandidate } from "./yt-dlp.js";

const PENALIZED_TERMS =
  /\b(cover|live|remix|reaction|review|shorts?|sped up|slowed|nightcore|karaoke)\b/i;
const POSITIVE_TERMS =
  /\b(official audio|official video|topic|provided to youtube)\b/i;

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

export function scoreCandidate(
  normalizedQuery: string,
  candidate: YoutubeSearchCandidate,
): number {
  const title = normalize(candidate.title);
  const queryTerms = normalizedQuery.split(" ").filter(Boolean);
  const matchingTerms = queryTerms.filter((term) =>
    title.includes(term),
  ).length;
  let score = queryTerms.length ? (matchingTerms / queryTerms.length) * 45 : 0;
  if (title === normalizedQuery) score += 25;
  if (POSITIVE_TERMS.test(candidate.title)) score += 10;
  if (
    candidate.channel &&
    /topic|official|records|music/i.test(candidate.channel)
  )
    score += 8;
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

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
