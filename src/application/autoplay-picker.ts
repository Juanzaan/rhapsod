export const AUTOPLAY_REQUESTER = "Autoplay";
export const AUTOPLAY_UID = "autoplay";

export interface AutoplayCandidate {
  readonly artist?: string;
  readonly durationSeconds?: number;
  readonly id: string;
  readonly source: string;
  readonly title: string;
}

export interface AutoplayProfile {
  artistScores(): ReadonlyMap<string, number>;
}

// The listening-history surface autoplay needs. ListeningHistory satisfies
// this structurally; the service takes it as an option so tests inject fakes.
export interface AutoplayProfileSource extends AutoplayProfile {
  recentArtists(limit: number): readonly string[];
}

const EXPLORE_RATE = 0.2;
const ARTIST_REPEAT_LIMIT = 2;

function normalizeArtist(artist: string): string {
  return artist.toLowerCase().trim();
}

// Picks the next autoplay track from a provider-ranked pool (a YouTube mix,
// related videos). Scoring is content-based affinity over what the channel
// actually played: 3 points per weighted artist play (plays + completes)
// plus the provider rank as a small prior. Epsilon-greedy exploration plus
// an artist-repeat veto keep the rotation from collapsing into one act.
export function pickAutoplayTrack(
  candidates: readonly AutoplayCandidate[],
  profile: AutoplayProfile,
  recentIds: ReadonlySet<string>,
  recentArtists: readonly string[],
  random: () => number = Math.random,
): AutoplayCandidate | undefined {
  const normalizedRecent = recentArtists.map(normalizeArtist);
  const fresh = candidates.filter(
    (candidate) =>
      !recentIds.has(candidate.id) &&
      normalizedRecent.filter(
        (artist) =>
          candidate.artist !== undefined &&
          artist === normalizeArtist(candidate.artist),
      ).length < ARTIST_REPEAT_LIMIT,
  );
  if (fresh.length === 0) return undefined;
  if (random() < EXPLORE_RATE) {
    return fresh[Math.floor(random() * fresh.length)];
  }
  const scores = profile.artistScores();
  let best = fresh[0]!;
  let bestScore = -Infinity;
  for (const [rank, candidate] of fresh.entries()) {
    const artistScore =
      candidate.artist === undefined
        ? 0
        : (scores.get(normalizeArtist(candidate.artist)) ?? 0);
    const score = 3 * artistScore + 1 / (rank + 1);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}
