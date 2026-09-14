import { safeFetch } from "../lib/ssrf.js";
import { UserError } from "../lib/user-error.js";

export interface AppleMusicTrack {
  readonly artist: string;
  readonly durationSeconds?: number;
  readonly title: string;
}

export interface AppleMusicResolver {
  getTrack(url: string): Promise<AppleMusicTrack>;
}

export interface AppleMusicClientOptions {
  readonly country?: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

const LOOKUP_BASE = "https://itunes.apple.com/lookup";
const DEFAULT_TIMEOUT_MS = 8_000;

// Song and album links carry the store id: ?i=<track> for songs, the
// trailing path id for albums and songs. Playlists resolve to no single
// track and yield undefined.
export function parseAppleMusicId(input: string): string | undefined {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return undefined;
  }
  const trackParam = url.searchParams.get("i") ?? "";
  if (/^\d+$/.test(trackParam)) return trackParam;
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0] === "playlist") return undefined;
  const last = segments.at(-1) ?? "";
  return /^\d+$/.test(last) ? last : undefined;
}

interface LookupResult {
  readonly artistName?: unknown;
  readonly collectionName?: unknown;
  readonly trackName?: unknown;
  readonly trackTimeMillis?: unknown;
}

// Keyless iTunes metadata for Apple Music links: the SongLink directory
// retired anonymous access (PUBLIC_API_ACCESS_DEPRECATED), so Apple Music
// links resolve here and play through a YouTube search, like Spotify.
export class AppleMusicClient implements AppleMusicResolver {
  readonly #country: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: AppleMusicClientOptions = {}) {
    this.#country = options.country ?? "US";
    this.#fetch = options.fetch ?? safeFetch;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async getTrack(url: string): Promise<AppleMusicTrack> {
    const id = parseAppleMusicId(url);
    if (id === undefined) {
      throw new UserError("No reconozco ese link de Apple Music.");
    }
    let response: Response;
    try {
      response = await this.#fetch(
        `${LOOKUP_BASE}?id=${encodeURIComponent(id)}&country=${encodeURIComponent(this.#country)}&limit=1`,
        {
          headers: { "user-agent": "Rhapsod/3.0 (apple-music)" },
          signal: AbortSignal.timeout(this.#timeoutMs),
        },
      );
    } catch {
      throw new UserError("No pude contactar a Apple Music. Probá de nuevo.");
    }
    if (!response.ok) {
      throw new UserError("No encontré esa canción en Apple Music.");
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new UserError("No encontré esa canción en Apple Music.");
    }
    const results =
      typeof body === "object" && body !== null
        ? (body as { results?: unknown }).results
        : undefined;
    const first = Array.isArray(results)
      ? (results[0] as LookupResult | undefined)
      : undefined;
    const track = parseLookupTrack(first);
    if (track === undefined) {
      throw new UserError("No encontré esa canción en Apple Music.");
    }
    return track;
  }
}

function parseLookupTrack(
  raw: LookupResult | undefined,
): AppleMusicTrack | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw.artistName !== "string" || raw.artistName.length === 0) {
    return undefined;
  }
  if (typeof raw.trackName === "string" && raw.trackName.length > 0) {
    return {
      artist: raw.artistName,
      ...(typeof raw.trackTimeMillis === "number" &&
      Number.isFinite(raw.trackTimeMillis) &&
      raw.trackTimeMillis > 0
        ? { durationSeconds: Math.round(raw.trackTimeMillis / 1000) }
        : {}),
      title: raw.trackName,
    };
  }
  if (typeof raw.collectionName === "string" && raw.collectionName.length > 0) {
    return { artist: raw.artistName, title: raw.collectionName };
  }
  return undefined;
}
