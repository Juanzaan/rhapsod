const SONGLINK_ENDPOINT = "https://api.song.link/v1-alpha.1/links";

export interface AlternativeSource {
  readonly provider: "youtube";
  readonly url: string;
}

export interface AlternativeSourceResolver {
  findAlternative(url: string): Promise<AlternativeSource | undefined>;
}

interface SongLinkResponse {
  linksByPlatform?: Record<string, { url?: string }>;
}

export interface SongLinkClientOptions {
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

export class SongLinkClient implements AlternativeSourceResolver {
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: SongLinkClientOptions = {}) {
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
  }

  async findAlternative(url: string): Promise<AlternativeSource | undefined> {
    const endpoint = new URL(SONGLINK_ENDPOINT);
    endpoint.searchParams.set("url", url);
    endpoint.searchParams.set("userCountry", "UY");
    const response = await this.#fetch(endpoint.toString(), {
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    if (!response.ok) return undefined;
    const data = (await response.json()) as SongLinkResponse;
    const candidate = data.linksByPlatform?.youtube?.url;
    if (!candidate || !isYouTubeUrl(candidate)) return undefined;
    return { provider: "youtube", url: candidate };
  }
}

function isYouTubeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "youtube.com" ||
        url.hostname === "www.youtube.com" ||
        url.hostname === "youtu.be")
    );
  } catch {
    return false;
  }
}
