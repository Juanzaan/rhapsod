import type { MinimalLogger } from "../../observability/logger.js";
import { noopLogger } from "../../observability/logger.js";
import { parseMediaInput } from "../media-input.js";
import type { SpotifyResource } from "../media-input.js";

export interface SpotifyTrackMetadata {
  readonly artist: string;
  readonly durationSeconds: number;
  readonly id: string;
  readonly title: string;
}

export interface SpotifyPlaylistExpansion {
  readonly tracks: readonly SpotifyTrackMetadata[];
  readonly total?: number;
}

export interface SpotifyResolver {
  readonly name: string;
  getTrack(resource: SpotifyResource): Promise<SpotifyTrackMetadata>;
  expandPlaylist(
    resource: SpotifyResource,
    limit: number,
  ): Promise<SpotifyPlaylistExpansion>;
  expandAlbum(
    resource: SpotifyResource,
    limit: number,
  ): Promise<SpotifyPlaylistExpansion>;
}

interface SpotifyApiOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken?: string;
  readonly fetch?: typeof fetch;
  readonly logger?: MinimalLogger;
  readonly timeoutMs?: number;
}

interface SpotifyPageResponse {
  readonly items: readonly (
    | SpotifyTrackResponse
    | { readonly track: SpotifyTrackResponse | null }
    | null
  )[];
  readonly next: string | null;
  readonly total: number;
}

const DEFAULT_TIMEOUT_MS = 12_000;
const TOKEN_EXPIRY_MARGIN_MS = 60_000;
const PAGE_SIZE = 50;
const EMBED_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const EMBED_TRACK_PATTERN =
  /"uri":"spotify:track:([A-Za-z0-9]+)"[\s\S]{0,200}?"title":"((?:[^"\\]|\\.)*)","subtitle":"((?:[^"\\]|\\.)*)"[\s\S]{0,300}?"duration":(\d+)/g;

interface SpotifyToken {
  readonly accessToken: string;
  readonly expiresAt: number;
}

interface SpotifyTrackResponse {
  readonly artists: readonly { readonly name: string }[];
  readonly duration_ms: number;
  readonly id: string;
  readonly name: string;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function decodeEmbedText(value: string): string {
  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

export class SpotifyApi implements SpotifyResolver {
  readonly name = "spotify";
  readonly #clientId: string;
  readonly #clientSecret: string;
  readonly #refreshToken: string | undefined;
  readonly #fetch: typeof fetch;
  readonly #logger: MinimalLogger;
  readonly #timeoutMs: number;
  #token: SpotifyToken | undefined;
  #tokenRequest: Promise<string> | undefined;

  constructor(options: SpotifyApiOptions) {
    this.#clientId = options.clientId;
    this.#clientSecret = options.clientSecret;
    this.#refreshToken = options.refreshToken;
    this.#fetch = options.fetch ?? fetch;
    this.#logger = options.logger ?? noopLogger;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  match(input: string): boolean {
    try {
      return parseMediaInput(input).kind === "spotify";
    } catch {
      return false;
    }
  }

  async getTrack(resource: SpotifyResource): Promise<SpotifyTrackMetadata> {
    const track = await this.#fetchJson<SpotifyTrackResponse>(
      `https://api.spotify.com/v1/tracks/${resource.id}`,
    );
    return this.#toMetadata(track);
  }

  async expandPlaylist(
    resource: SpotifyResource,
    limit: number,
  ): Promise<SpotifyPlaylistExpansion> {
    if (resource.type !== "playlist")
      throw new Error("Only Spotify playlists can be expanded");
    const collectionUrl = `https://api.spotify.com/v1/playlists/${resource.id}/${this.#refreshToken === undefined ? "tracks" : "items"}`;
    try {
      return await this.#expandCollection(collectionUrl, limit, (page) =>
        page.items.flatMap((item) => {
          const track = item && "track" in item ? item.track : null;
          return track ? [this.#toMetadata(track)] : [];
        }),
      );
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !/Spotify API returned (403|404)/.test(error.message)
      ) {
        throw error;
      }
      const embedded = await this.#expandPlaylistFromEmbed(resource.id, limit);
      if (embedded.tracks.length > 0) return embedded;
      throw new Error(
        `Spotify API returned 404/403: la playlist no se puede leer por la API (Spotify solo da acceso a playlists a apps con extended quota) ni por el embed público`,
        { cause: error },
      );
    }
  }

  async #expandPlaylistFromEmbed(
    playlistId: string,
    limit: number,
  ): Promise<SpotifyPlaylistExpansion> {
    const response = await this.#request(
      `https://open.spotify.com/embed/playlist/${playlistId}`,
      { "User-Agent": EMBED_USER_AGENT },
    );
    if (!response.ok) {
      throw new Error(`Spotify embed returned ${response.status}`);
    }
    const html = await response.text();
    const tracks: SpotifyTrackMetadata[] = [];
    const seen = new Set<string>();
    for (const match of html.matchAll(EMBED_TRACK_PATTERN)) {
      const id = match[1];
      if (!id || seen.has(id)) continue;
      seen.add(id);
      tracks.push({
        artist: decodeEmbedText(match[3] ?? ""),
        durationSeconds: Math.round(Number(match[4] ?? 0) / 1000),
        id,
        title: decodeEmbedText(match[2] ?? ""),
      });
      if (tracks.length >= limit) break;
    }
    return { tracks };
  }

  async expandAlbum(
    resource: SpotifyResource,
    limit: number,
  ): Promise<SpotifyPlaylistExpansion> {
    if (resource.type !== "album")
      throw new Error("Only Spotify albums can be expanded");
    return this.#expandCollection(
      `https://api.spotify.com/v1/albums/${resource.id}/tracks`,
      limit,
      (page) =>
        page.items.flatMap((item) =>
          item && !("track" in item) ? [this.#toMetadata(item)] : [],
        ),
    );
  }

  async #expandCollection(
    baseUrl: string,
    limit: number,
    extract: (page: SpotifyPageResponse) => SpotifyTrackMetadata[],
  ): Promise<SpotifyPlaylistExpansion> {
    const tracks: SpotifyTrackMetadata[] = [];
    const seen = new Set<string>();
    let total: number | undefined;
    let offset = 0;
    while (tracks.length < limit) {
      const pageUrl = `${baseUrl}?limit=${Math.min(
        PAGE_SIZE,
        limit - tracks.length,
      )}&offset=${offset}`;
      const page = await this.#fetchJson<SpotifyPageResponse>(pageUrl);
      total = page.total;
      for (const track of extract(page)) {
        if (seen.has(track.id)) continue;
        seen.add(track.id);
        tracks.push(track);
        if (tracks.length >= limit) break;
      }
      if (tracks.length >= limit || !page.next || page.items.length === 0) {
        break;
      }
      offset += page.items.length;
    }
    return { tracks, ...(total === undefined ? {} : { total }) };
  }

  #toMetadata(track: SpotifyTrackResponse): SpotifyTrackMetadata {
    return {
      artist: track.artists[0]?.name ?? "Artista desconocido",
      durationSeconds: Math.round(track.duration_ms / 1000),
      id: track.id,
      title: track.name,
    };
  }

  async #fetchJson<T>(url: string): Promise<T> {
    let authorizationAttempts = 1;
    let rateLimitAttempts = 3;
    for (;;) {
      const accessToken = await this.#accessToken();
      const response = await this.#request(url, {
        Authorization: `Bearer ${accessToken}`,
      });
      if (response.status === 401) {
        if (authorizationAttempts <= 0) {
          throw new Error(`Spotify API returned ${response.status}`);
        }
        this.#logger.warn(
          { status: response.status, retry: 1 - authorizationAttempts + 1 },
          "Spotify: token expired, refreshing",
        );
        this.#token = undefined;
        authorizationAttempts--;
        continue;
      }
      if (response.status === 429) {
        if (rateLimitAttempts <= 0) {
          throw new Error(`Spotify API returned ${response.status}`);
        }
        const retryAfter = Number(response.headers.get("retry-after") ?? "1");
        const delayMs =
          (Number.isFinite(retryAfter) ? Math.min(retryAfter, 10) : 1) * 1000;
        this.#logger.warn(
          {
            status: response.status,
            retryAfterMs: delayMs,
            retry: 3 - rateLimitAttempts + 1,
          },
          "Spotify: rate limited, waiting",
        );
        await sleep(delayMs);
        rateLimitAttempts--;
        continue;
      }
      if (response.status === 403 && this.#refreshToken === undefined) {
        throw new Error(
          "Spotify API returned 403: reading playlists requires RHAPSOD_SPOTIFY_REFRESH_TOKEN (Spotify's 2026 API migration dropped the anonymous endpoint)",
        );
      }
      if (!response.ok) {
        throw new Error(`Spotify API returned ${response.status}`);
      }
      return (await response.json()) as T;
    }
  }

  async #accessToken(): Promise<string> {
    if (this.#token && this.#token.expiresAt > Date.now()) {
      return this.#token.accessToken;
    }
    if (this.#tokenRequest !== undefined) return this.#tokenRequest;
    const request = this.#requestAccessToken();
    this.#tokenRequest = request;
    try {
      return await request;
    } finally {
      if (this.#tokenRequest === request) this.#tokenRequest = undefined;
    }
  }

  async #requestAccessToken(): Promise<string> {
    const body =
      this.#refreshToken === undefined
        ? new URLSearchParams({ grant_type: "client_credentials" })
        : new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: this.#refreshToken,
          });
    const response = await this.#request(
      "https://accounts.spotify.com/api/token",
      {
        Authorization: `Basic ${Buffer.from(`${this.#clientId}:${this.#clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      {
        body,
        method: "POST",
      },
    );
    if (!response.ok) {
      throw new Error(
        `Spotify ${this.#refreshToken === undefined ? "token" : "refresh token"} request failed with ${response.status}`,
      );
    }
    const json = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (
      typeof json.access_token !== "string" ||
      json.access_token.length === 0
    ) {
      throw new Error("Spotify token response is missing access_token");
    }
    const expiresInSeconds = json.expires_in ?? 3600;
    this.#token = {
      accessToken: json.access_token,
      expiresAt: Date.now() + expiresInSeconds * 1000 - TOKEN_EXPIRY_MARGIN_MS,
    };
    return json.access_token;
  }

  async #request(
    url: string,
    headers: Record<string, string>,
    init: RequestInit = {},
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      return await this.#fetch(url, {
        ...init,
        headers: { ...headers, ...init.headers },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
