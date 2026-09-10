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
const EXPLORE_ENERGY_FLOOR = 0.5;
const ARTIST_REPEAT_LIMIT = 2;
const CONTINUITY_WEIGHT = 2;
const SAME_ARTIST_BONUS = 0.5;
const ROTATION_PENALTY = 0.3;
const TOKEN_WEIGHT = 1;
const ARTIST_WEIGHT = 3;
const TOKEN_OVERLAP_CAP = 3;

const ENERGETIC_TOKENS = new Set(
  "remix club dance party phonk hardstyle edm electro techno house workout gym fiesta perreo nightcore sped dnb drum bass cardio run energia energy pump hype rave festival anthem turreo".split(
    " ",
  ),
);

const CALM_TOKENS = new Set(
  "acoustic unplugged piano chill lofi ambient balada lenta lento relax soft slowed bossa jazz sleep calm tranquila tranquilo suave lullaby meditation yoga clasica classical".split(
    " ",
  ),
);

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

// Rough energy estimate from title words (-1 calm … +1 energetic, 0 unknown).
// Same energy across different artists is what makes a transition feel
// smooth; the artist name alone would lock the rotation onto one act.
export function energyOfTitle(title: string): number {
  const tokens = tokenizeTitle(title);
  if (tokens.length === 0) return 0;
  let signal = 0;
  for (const token of tokens) {
    if (ENERGETIC_TOKENS.has(token)) signal += 1;
    else if (CALM_TOKENS.has(token)) signal -= 1;
  }
  return signal / tokens.length;
}

function energyProximity(a: string, b: string): number {
  return 1 - Math.min(1, Math.abs(energyOfTitle(a) - energyOfTitle(b)));
}

// Picks the next autoplay track from a provider-ranked pool (a YouTube mix,
// related videos). Scoring mixes the listener's taste profile (artist
// affinity, token overlap) with energy continuity against the track that
// just played, so consecutive picks flow instead of jumping genres. A small
// same-artist bridge plus a soft rotation penalty rotate acts instead of
// locking onto one, and epsilon-greedy exploration stays within compatible
// energy so discovery never causes a jarring jump.
export function pickAutoplayTrack(
  candidates: readonly AutoplayCandidate[],
  profile: AutoplayProfile,
  recentIds: ReadonlySet<string>,
  recentArtists: readonly string[],
  lastTrack?: LastPlayedTrack,
  random: () => number = Math.random,
): AutoplayCandidate | undefined {
  const normalizedRecent = recentArtists.map(normalizeArtist);
  const recentCount = (artist: string | undefined): number =>
    artist === undefined
      ? 0
      : normalizedRecent.filter((recent) => recent === normalizeArtist(artist))
          .length;
  const fresh = candidates.filter(
    (candidate) =>
      !recentIds.has(candidate.id) &&
      recentCount(candidate.artist) < ARTIST_REPEAT_LIMIT,
  );
  if (fresh.length === 0) return undefined;
  if (random() < EXPLORE_RATE) {
    const compatible =
      lastTrack === undefined
        ? fresh
        : fresh.filter(
            (candidate) =>
              energyProximity(lastTrack.title, candidate.title) >
              EXPLORE_ENERGY_FLOOR,
          );
    const pool = compatible.length > 0 ? compatible : fresh;
    return pool[Math.floor(random() * pool.length)];
  }
  const artistScores = profile.artistScores;
  const tokenScores = profile.tokenScores;
  const lastArtist =
    lastTrack?.artist === undefined
      ? undefined
      : normalizeArtist(lastTrack.artist);
  let best = fresh[0]!;
  let bestScore = -Infinity;
  for (const [rank, candidate] of fresh.entries()) {
    const normalizedCandidate =
      candidate.artist === undefined
        ? undefined
        : normalizeArtist(candidate.artist);
    const artistScore =
      normalizedCandidate === undefined
        ? 0
        : (artistScores.get(normalizedCandidate) ?? 0);
    let tokenScore = 0;
    for (const token of tokenizeTitle(candidate.title)) {
      tokenScore += tokenScores.get(token) ?? 0;
    }
    tokenScore = Math.min(tokenScore, TOKEN_OVERLAP_CAP);
    const continuity =
      lastTrack === undefined
        ? 0
        : energyProximity(lastTrack.title, candidate.title);
    const sameArtist =
      lastArtist !== undefined && normalizedCandidate === lastArtist ? 1 : 0;
    const score =
      ARTIST_WEIGHT * artistScore +
      TOKEN_WEIGHT * tokenScore +
      CONTINUITY_WEIGHT * continuity +
      SAME_ARTIST_BONUS * sameArtist -
      ROTATION_PENALTY * recentCount(candidate.artist) +
      1 / (rank + 1);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}
