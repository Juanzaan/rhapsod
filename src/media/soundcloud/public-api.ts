import type { YoutubeTrackMetadata } from "../youtube/yt-dlp.js";

const HOME_URL = "https://soundcloud.com/";
const API_URL = "https://api-v2.soundcloud.com";
const CLIENT_ID_TTL_MS = 6 * 60 * 60_000;

interface Transcoding {
  readonly format?: { readonly protocol?: string };
  readonly url?: string;
}

interface SoundCloudTrack {
  readonly access?: string;
  readonly duration?: number;
  readonly id?: number;
  readonly media?: { readonly transcodings?: Transcoding[] };
  readonly permalink_url?: string;
  readonly policy?: string;
  readonly publisher_metadata?: { readonly artist?: string };
  readonly streamable?: boolean;
  readonly title?: string;
  readonly user?: { readonly username?: string };
}

export interface SoundCloudDrmMetadata {
  readonly artist: string;
  readonly durationSeconds?: number;
  readonly title: string;
}

export class SoundCloudDrmError extends Error {
  constructor(readonly metadata: SoundCloudDrmMetadata) {
    super("This SoundCloud track is DRM protected or blocked");
    this.name = "SoundCloudDrmError";
  }
}

export interface SoundCloudResolver {
  readonly name: string;
  match(input: string): boolean;
  getAudioUrl(url: string): Promise<string>;
  getTrack(url: string): Promise<YoutubeTrackMetadata>;
}

interface SoundCloudPublicApiOptions {
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

export class SoundCloudPublicApi implements SoundCloudResolver {
  readonly name = "soundcloud";
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  #clientId: { expiresAt: number; value: string } | undefined;

  constructor(options: SoundCloudPublicApiOptions = {}) {
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 12_000;
  }

  match(input: string): boolean {
    try {
      const hostname = new URL(input).hostname;
      return (
        hostname === "soundcloud.com" ||
        hostname === "www.soundcloud.com" ||
        hostname === "on.soundcloud.com"
      );
    } catch {
      return false;
    }
  }

  async getTrack(url: string): Promise<YoutubeTrackMetadata> {
    const track = await this.#resolve(url);
    assertPlayable(track);
    const audioUrl = await this.#resolveTranscoding(track);
    if (!audioUrl) throw new SoundCloudDrmError(drmMetadata(track));
    return {
      audioUrl,
      id: `soundcloud:${track.id}`,
      title: track.title ?? "SoundCloud track",
      webpageUrl: track.permalink_url ?? url,
    };
  }

  async getAudioUrl(url: string): Promise<string> {
    const track = await this.#resolve(url);
    assertPlayable(track);
    const audioUrl = await this.#resolveTranscoding(track);
    if (!audioUrl) throw new SoundCloudDrmError(drmMetadata(track));
    return audioUrl;
  }

  async #resolve(url: string): Promise<SoundCloudTrack> {
    const resolvedUrl = await this.#followShortLink(url);
    return this.#apiRequest<SoundCloudTrack>(
      `/resolve?url=${encodeURIComponent(resolvedUrl)}`,
    );
  }

  async #resolveTranscoding(
    track: SoundCloudTrack,
  ): Promise<string | undefined> {
    const transcodings = track.media?.transcodings ?? [];
    const candidates = transcodings.filter(
      (item) =>
        item.format?.protocol === "progressive" ||
        item.format?.protocol === "hls",
    );
    for (const selected of candidates) {
      if (!selected.url) continue;
      try {
        const response = await this.#apiRequest<{ url?: string }>(selected.url);
        if (response.url?.startsWith("https://")) return response.url;
      } catch {
        // Try the next unencrypted transcoding before reporting DRM.
      }
    }
    return undefined;
  }

  async #apiRequest<T>(pathOrUrl: string, retry = true): Promise<T> {
    const clientId = await this.#getClientId();
    const endpoint = new URL(pathOrUrl, API_URL);
    endpoint.searchParams.set("client_id", clientId);
    const response = await this.#fetch(endpoint, {
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    if (response.status === 401 && retry) {
      this.#clientId = undefined;
      return this.#apiRequest<T>(pathOrUrl, false);
    }
    if (!response.ok)
      throw new Error(`SoundCloud API returned ${response.status}`);
    return (await response.json()) as T;
  }

  async #getClientId(): Promise<string> {
    if (this.#clientId && this.#clientId.expiresAt > Date.now())
      return this.#clientId.value;
    const home = await this.#fetch(HOME_URL, {
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    if (!home.ok)
      throw new Error("Unable to load SoundCloud client configuration");
    const html = await home.text();
    const scripts = [
      ...html.matchAll(
        /<script[^>]+src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"?]+\.js)"/g,
      ),
    ]
      .map((match) => match[1])
      .filter((value): value is string => value !== undefined)
      .reverse();
    const scriptSources = await Promise.all(
      scripts.slice(0, 12).map(async (script) => {
        try {
          const response = await this.#fetch(script, {
            signal: AbortSignal.timeout(this.#timeoutMs),
          });
          return response.ok ? await response.text() : "";
        } catch {
          return "";
        }
      }),
    );
    for (const source of scriptSources) {
      const match = /client_id\s*[:=]\s*["']([A-Za-z0-9_-]{20,})["']/.exec(
        source,
      );
      if (!match?.[1]) continue;
      this.#clientId = {
        expiresAt: Date.now() + CLIENT_ID_TTL_MS,
        value: match[1],
      };
      return match[1];
    }
    throw new Error("Unable to discover SoundCloud client configuration");
  }

  async #followShortLink(url: string): Promise<string> {
    if (new URL(url).hostname !== "on.soundcloud.com") return url;
    const response = await this.#fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    return response.url || url;
  }
}

function assertPlayable(track: SoundCloudTrack): void {
  if (
    track.access === "blocked" ||
    track.policy === "BLOCK" ||
    track.streamable === false
  ) {
    throw new SoundCloudDrmError(drmMetadata(track));
  }
  if (!track.id || !track.title)
    throw new Error("SoundCloud returned incomplete track metadata");
}

function drmMetadata(track: SoundCloudTrack): SoundCloudDrmMetadata {
  return {
    artist:
      track.publisher_metadata?.artist ??
      track.user?.username ??
      artistFromPermalink(track.permalink_url) ??
      "SoundCloud",
    ...(track.duration === undefined
      ? {}
      : { durationSeconds: Math.round(track.duration / 1_000) }),
    title: track.title ?? "Unknown track",
  };
}

function artistFromPermalink(
  permalinkUrl: string | undefined,
): string | undefined {
  if (!permalinkUrl) return undefined;
  try {
    const segment = new URL(permalinkUrl).pathname
      .split("/")
      .filter(Boolean)[0];
    return segment ? decodeURIComponent(segment) : undefined;
  } catch {
    return undefined;
  }
}
