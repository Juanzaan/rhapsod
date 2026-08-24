const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface YoutubeOAuthTokens {
  readonly accessToken: string;
  readonly expiresAt: number;
}

export interface YoutubeOAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
}

export interface YoutubeOAuthLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

const noopLogger: YoutubeOAuthLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

export class YoutubeOAuth {
  #currentTokens: YoutubeOAuthTokens | undefined;
  readonly #config: YoutubeOAuthConfig;
  readonly #fetchImpl: typeof fetch;
  readonly #logger: YoutubeOAuthLogger;

  constructor(
    config: YoutubeOAuthConfig,
    fetchImpl: typeof fetch = fetch,
    logger?: YoutubeOAuthLogger,
  ) {
    this.#config = config;
    this.#fetchImpl = fetchImpl;
    this.#logger = logger ?? noopLogger;
  }

  async getAccessToken(): Promise<string> {
    if (this.#currentTokens && this.#currentTokens.expiresAt > Date.now()) {
      return this.#currentTokens.accessToken;
    }
    return this.#refreshAccessToken();
  }

  async #refreshAccessToken(): Promise<string> {
    const body = new URLSearchParams({
      client_id: this.#config.clientId,
      client_secret: this.#config.clientSecret,
      refresh_token: this.#config.refreshToken,
      grant_type: "refresh_token",
    });

    this.#logger.info({}, "YouTube OAuth: refreshing access token");

    const response = await this.#fetchImpl(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.#logger.error(
        { status: response.status, error: errorText },
        "YouTube OAuth: token refresh failed",
      );
      throw new Error(
        `YouTube OAuth token refresh failed (${response.status}): ${errorText}`,
      );
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
      token_type: string;
      scope?: string;
    };

    if (!data.access_token) {
      this.#logger.error({}, "YouTube OAuth: response missing access_token");
      throw new Error("YouTube OAuth response missing access_token");
    }

    this.#currentTokens = {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000 - 60_000,
    };

    this.#logger.info(
      { expiresIn: data.expires_in },
      "YouTube OAuth: token refreshed successfully",
    );

    return this.#currentTokens.accessToken;
  }

  invalidate(): void {
    this.#currentTokens = undefined;
  }
}
