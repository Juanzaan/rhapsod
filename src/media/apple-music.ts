import { safeFetch } from "../lib/ssrf.js";
import { UserError } from "../lib/user-error.js";

export interface AppleMusicTrack {
  readonly artist: string;
  readonly durationSeconds?: number;
  readonly id: string;
  readonly title: string;
  readonly url?: string;
}

export interface AppleMusicPlaylist {
  readonly name?: string;
  readonly tracks: readonly AppleMusicTrack[];
}

export interface AppleMusicResolver {
  getPlaylist(url: string): Promise<AppleMusicPlaylist>;
  getTrack(url: string): Promise<AppleMusicTrack>;
}

export interface AppleMusicClientOptions {
  readonly country?: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

const LOOKUP_BASE = "https://itunes.apple.com/lookup";
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_PLAYLIST_TRACKS = 100;

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

export function isAppleMusicPlaylist(input: string): boolean {
  try {
    // music.apple.com URLs carry a locale first (/pe/playlist/...).
    const segments = new URL(input.trim()).pathname.split("/").filter(Boolean);
    return segments.includes("playlist");
  } catch {
    return false;
  }
}

function parsePlaylistName(page: string): string | undefined {
  const title = /<title>([^<]*)<\/title>/i.exec(page)?.[1] ?? "";
  // Titles can open with an invisible direction mark (U+200E).
  const match =
    /^[\s\u200e\u200f\ufeff]*["“](.+?)["”] de .* en Apple\sMusic$/u.exec(
      title.trim().replace(/\u00a0/g, " "),
    );
  const name = match?.[1]?.trim();
  return name !== undefined && name.length > 0 ? name : undefined;
}

interface LookupResult {
  readonly artistName?: unknown;
  readonly collectionName?: unknown;
  readonly trackId?: unknown;
  readonly trackName?: unknown;
  readonly trackTimeMillis?: unknown;
  readonly trackViewUrl?: unknown;
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
    const [first] = await this.#lookup([id]);
    const track = parseLookupTrack(first);
    if (track === undefined) {
      throw new UserError("No encontré esa canción en Apple Music.");
    }
    return { id, ...track };
  }

  // Playlist tracks have no store id of their own, so the page HTML is
  // the only keyless source: /song/<slug>/<id> links come out in play
  // order, and one batched lookup resolves them all to artist + title.
  async getPlaylist(url: string): Promise<AppleMusicPlaylist> {
    if (!isAppleMusicPlaylist(url)) {
      throw new UserError("No reconozco esa playlist de Apple Music.");
    }
    let page: string;
    try {
      const response = await this.#fetch(url.trim(), {
        // Apple serves the catalog page to browsers; the API user-agent
        // gets an empty shell with no track list.
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(Math.max(this.#timeoutMs, 15_000)),
      });
      if (!response.ok) {
        throw new UserError("No encontré esa playlist en Apple Music.");
      }
      page = await response.text();
    } catch (error) {
      if (error instanceof UserError) throw error;
      throw new UserError("No pude contactar a Apple Music. Probá de nuevo.");
    }
    const ids = [...page.matchAll(/\/song\/[a-z0-9-]+\/(\d+)/gi)]
      .map((match) => match[1] ?? "")
      .filter((id, index, all) => id.length > 0 && all.indexOf(id) === index)
      .slice(0, MAX_PLAYLIST_TRACKS);
    if (ids.length === 0) {
      throw new UserError("No encontré canciones en esa playlist.");
    }
    const results = await this.#lookup(ids);
    const byId = new Map<string, LookupResult>();
    for (const result of results) {
      if (
        typeof result.trackId === "number" &&
        Number.isSafeInteger(result.trackId)
      ) {
        byId.set(String(result.trackId), result);
      }
    }
    const tracks: AppleMusicTrack[] = [];
    for (const id of ids) {
      const parsed = parseLookupTrack(byId.get(id));
      if (parsed !== undefined) tracks.push({ id, ...parsed });
    }
    if (tracks.length === 0) {
      throw new UserError("No encontré canciones en esa playlist.");
    }
    const name = parsePlaylistName(page);
    return { ...(name === undefined ? {} : { name }), tracks };
  }

  async #lookup(ids: readonly string[]): Promise<readonly LookupResult[]> {
    let response: Response;
    try {
      response = await this.#fetch(
        `${LOOKUP_BASE}?id=${ids.map((id) => encodeURIComponent(id)).join(",")}&country=${encodeURIComponent(this.#country)}&entity=song&limit=${ids.length}`,
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
    if (!Array.isArray(results)) return [];
    return results as LookupResult[];
  }
}

function parseLookupTrack(
  raw: LookupResult | undefined,
): Omit<AppleMusicTrack, "id"> | undefined {
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
      ...(typeof raw.trackViewUrl === "string" && raw.trackViewUrl.length > 0
        ? { url: raw.trackViewUrl }
        : {}),
    };
  }
  if (typeof raw.collectionName === "string" && raw.collectionName.length > 0) {
    return { artist: raw.artistName, title: raw.collectionName };
  }
  return undefined;
}
