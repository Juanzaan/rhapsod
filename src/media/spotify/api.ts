import { parseMediaInput } from "../media-input.js";
import type { SpotifyResource } from "../media-input.js";

export interface SpotifyTrackMetadata {
  readonly artist: string;
  readonly durationSeconds: number;
  readonly id: string;
  readonly title: string;
}

export interface SpotifyResolver {
  readonly name: string;
  match(input: string): boolean;
  getTrack(resource: SpotifyResource): Promise<SpotifyTrackMetadata>;
}

export interface SpotifyApiOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 12_000;
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

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

export class SpotifyApi implements SpotifyResolver {
  readonly name = "spotify";
  readonly #clientId: string;
  readonly #clientSecret: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  #token: SpotifyToken | undefined;

  constructor(options: SpotifyApiOptions) {
    this.#clientId = options.clientId;
    this.#clientSecret = options.clientSecret;
    this.#fetch = options.fetch ?? fetch;
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
    const track = await this.#fetchTrack(resource.id);
    return {
      artist: track.artists[0]?.name ?? "Artista desconocido",
      durationSeconds: Math.round(track.duration_ms / 1000),
      id: track.id,
      title: track.name,
    };
  }

  async #fetchTrack(id: string): Promise<SpotifyTrackResponse> {
    let attempts = 2;
    while (attempts > 0) {
      const accessToken = await this.#accessToken();
      const response = await this.#request(
        `https://api.spotify.com/v1/tracks/${id}`,
        { Authorization: `Bearer ${accessToken}` },
      );
      if (response.status === 401) {
        this.#token = undefined;
        attempts--;
        continue;
      }
      if (!response.ok) {
        throw new Error(`Spotify API returned ${response.status}`);
      }
      return (await response.json()) as SpotifyTrackResponse;
    }
    throw new Error("Spotify API returned 401");
  }

  async #accessToken(): Promise<string> {
    if (this.#token && this.#token.expiresAt > Date.now()) {
      return this.#token.accessToken;
    }
    const response = await this.#request(
      "https://accounts.spotify.com/api/token",
      {
        Authorization: `Basic ${Buffer.from(`${this.#clientId}:${this.#clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      {
        body: new URLSearchParams({ grant_type: "client_credentials" }),
        method: "POST",
      },
    );
    if (!response.ok) {
      throw new Error(`Spotify token request failed with ${response.status}`);
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
