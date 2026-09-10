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
  readonly artistScores: ReadonlyMap<string, number>;
  readonly tokenScores: ReadonlyMap<string, number>;
}

// The listening-history surface autoplay needs. ListeningHistory satisfies
// this structurally; the service takes it as an option so tests inject fakes.
export interface AutoplayProfileSource {
  artistScores(): ReadonlyMap<string, number>;
  tasteProfile(uid: string): AutoplayProfile;
  recentArtists(limit: number): readonly string[];
}

export interface LastPlayedTrack {
  readonly artist?: string;
  readonly title: string;
}

const EXPLORE_RATE = 0.2;
const ARTIST_REPEAT_LIMIT = 2;
const CONTINUITY_WEIGHT = 2;
const TOKEN_WEIGHT = 1;
const ARTIST_WEIGHT = 3;
const TOKEN_OVERLAP_CAP = 3;

const STOPWORDS = new Set(
  "de la el en y a los las un una con por para the and of a to in on for with feat ft vs".split(
    " ",
  ),
);

function normalizeArtist(artist: string): string {
  return artist.toLowerCase().trim();
}

export function tokenizeTitle(title: string): readonly string[] {
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

// Picks the next autoplay track from a provider-ranked pool (a YouTube mix,
// related videos). Scoring mixes the listener's taste profile (artist
// affinity, token overlap) with continuity against the track that just
// played, so consecutive picks flow instead of jumping genres. Epsilon-greedy
// exploration plus an artist-repeat veto keep the rotation from collapsing
// into one act.
export function pickAutoplayTrack(
  candidates: readonly AutoplayCandidate[],
  profile: AutoplayProfile,
  recentIds: ReadonlySet<string>,
  recentArtists: readonly string[],
  lastTrack?: LastPlayedTrack,
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
  const artistScores = profile.artistScores;
  const tokenScores = profile.tokenScores;
  const lastTokens =
    lastTrack === undefined ? [] : tokenizeTitle(lastTrack.title);
  const lastArtist =
    lastTrack?.artist === undefined
      ? undefined
      : normalizeArtist(lastTrack.artist);
  let best = fresh[0]!;
  let bestScore = -Infinity;
  for (const [rank, candidate] of fresh.entries()) {
    const artistScore =
      candidate.artist === undefined
        ? 0
        : (artistScores.get(normalizeArtist(candidate.artist)) ?? 0);
    let tokenScore = 0;
    for (const token of tokenizeTitle(candidate.title)) {
      tokenScore += tokenScores.get(token) ?? 0;
    }
    tokenScore = Math.min(tokenScore, TOKEN_OVERLAP_CAP);
    let continuity = 0;
    if (lastArtist !== undefined && candidate.artist !== undefined) {
      continuity =
        normalizeArtist(candidate.artist) === lastArtist
          ? 1
          : Math.min(
              tokenizeTitle(candidate.title).filter((token) =>
                lastTokens.includes(token),
              ).length * 0.25,
              1,
            );
    }
    const score =
      ARTIST_WEIGHT * artistScore +
      TOKEN_WEIGHT * tokenScore +
      CONTINUITY_WEIGHT * continuity +
      1 / (rank + 1);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}
