interface PotResponse {
  readonly poToken?: string;
  readonly po_token?: string;
  readonly contentBinding?: string;
  readonly expiresAt?: string;
}

interface CachedPot {
  readonly token: string;
  readonly expiresAt: number;
}

export interface PoTokenProvider {
  get(videoId: string): Promise<string>;
  invalidate(videoId: string): void;
}

const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;
const FALLBACK_TOKEN_TTL_MS = 6 * 60 * 60_000;

export class HttpPoTokenProvider implements PoTokenProvider {
  readonly #cache = new Map<string, CachedPot>();
  readonly #inFlight = new Map<string, Promise<string>>();

  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async get(videoId: string): Promise<string> {
    const cached = this.#cache.get(videoId);
    if (
      cached !== undefined &&
      cached.expiresAt > Date.now() + TOKEN_REFRESH_MARGIN_MS
    ) {
      return cached.token;
    }
    const inFlight = this.#inFlight.get(videoId);
    if (inFlight !== undefined) return inFlight;

    const request = this.#fetchToken(videoId);
    this.#inFlight.set(videoId, request);
    try {
      return await request;
    } finally {
      if (this.#inFlight.get(videoId) === request) {
        this.#inFlight.delete(videoId);
      }
    }
  }

  invalidate(videoId: string): void {
    this.#cache.delete(videoId);
  }

  async #fetchToken(videoId: string): Promise<string> {
    const response = await this.fetchImpl(new URL("/get_pot", this.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content_binding: videoId }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`POT provider returned HTTP ${response.status}`);
    }

    const data = (await response.json()) as PotResponse;
    const token = data.poToken ?? data.po_token;
    if (!token) throw new Error("POT provider returned no poToken");
    if (data.contentBinding !== undefined && data.contentBinding !== videoId) {
      throw new Error("POT provider returned a mismatched content binding");
    }

    const parsedExpiry = data.expiresAt
      ? Date.parse(data.expiresAt)
      : Number.NaN;
    const expiresAt = Number.isFinite(parsedExpiry)
      ? parsedExpiry
      : Date.now() + FALLBACK_TOKEN_TTL_MS;
    this.#cache.set(videoId, { token, expiresAt });
    return token;
  }
}
