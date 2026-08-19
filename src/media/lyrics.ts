const LRCLIB_SEARCH_ENDPOINT = "https://lrclib.net/api/search";

export interface TrackLyrics {
  readonly artist?: string;
  readonly plainLyrics: string;
  readonly title: string;
}

export interface LyricsResolver {
  search(
    artist: string | undefined,
    title: string,
  ): Promise<TrackLyrics | undefined>;
}

interface LrclibSearchHit {
  readonly artistName: string;
  readonly instrumental?: boolean;
  readonly plainLyrics?: string;
  readonly trackName: string;
}

interface LyricsClientOptions {
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

export class LyricsClient implements LyricsResolver {
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: LyricsClientOptions = {}) {
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
  }

  async search(
    artist: string | undefined,
    title: string,
  ): Promise<TrackLyrics | undefined> {
    try {
      const endpoint = new URL(LRCLIB_SEARCH_ENDPOINT);
      endpoint.searchParams.set("track_name", title);
      if (artist) endpoint.searchParams.set("artist_name", artist);
      const response = await this.#fetch(endpoint.toString(), {
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      if (!response.ok) return undefined;
      const hits = (await response.json()) as LrclibSearchHit[];
      const hit = hits.find(
        (candidate) => candidate.plainLyrics && !candidate.instrumental,
      );
      if (!hit?.plainLyrics) return undefined;
      return {
        ...(hit.artistName ? { artist: hit.artistName } : {}),
        plainLyrics: hit.plainLyrics,
        title: hit.trackName,
      };
    } catch {
      // Lyrics are best-effort. Playback never depends on them.
      return undefined;
    }
  }
}

export function parseArtistTitle(input: string): {
  artist?: string;
  title: string;
} {
  const stripped = stripAnnotations(input);
  const separator = stripped.indexOf(" - ");
  if (separator <= 0 || separator >= stripped.length - 3) {
    return { title: stripped || input };
  }
  const artist = stripped.slice(0, separator).trim();
  const title = stripped.slice(separator + 3).trim();
  if (!title) return { title: stripped };
  return { ...(artist ? { artist } : {}), title };
}

function stripAnnotations(value: string): string {
  return value
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
