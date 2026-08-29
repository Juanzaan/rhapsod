import { isPublicHostname, safeFetch } from "../lib/ssrf.js";

export interface RedirectResolverOptions {
  readonly cacheMaxEntries?: number;
  readonly fetch?: typeof fetch;
  readonly maxRedirects?: number;
  readonly timeoutMs?: number;
}

const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_CACHE_MAX_ENTRIES = 200;

export class RedirectResolver {
  readonly #cache = new Map<string, string>();
  readonly #cacheMaxEntries: number;
  readonly #fetch: typeof fetch;
  readonly #maxRedirects: number;
  readonly #timeoutMs: number;

  constructor(options: RedirectResolverOptions = {}) {
    this.#fetch = options.fetch ?? safeFetch;
    this.#maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#cacheMaxEntries =
      options.cacheMaxEntries ?? DEFAULT_CACHE_MAX_ENTRIES;
  }

  async resolve(url: string): Promise<string | undefined> {
    const cached = this.#cache.get(url);
    if (cached !== undefined) return cached;
    let current = url;
    for (let hop = 0; hop <= this.#maxRedirects; hop++) {
      let parsed: URL;
      try {
        parsed = new URL(current);
      } catch {
        return undefined;
      }
      if (parsed.protocol !== "https:") return undefined;
      if (!(await isPublicHostname(parsed.hostname))) return undefined;
      const response = await this.#head(current);
      if (response === undefined) return undefined;
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (location === null) return undefined;
        try {
          current = new URL(location, current).toString();
        } catch {
          return undefined;
        }
        continue;
      }
      this.#cacheAndBound(url, current);
      return current;
    }
    return undefined;
  }

  async #head(url: string): Promise<Response | undefined> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      return await this.#fetch(url, {
        headers: { "user-agent": "Rhapsod/1 (redirect-resolver)" },
        method: "HEAD",
        redirect: "manual",
        signal: controller.signal,
      });
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  #cacheAndBound(key: string, value: string): void {
    this.#cache.set(key, value);
    if (this.#cache.size > this.#cacheMaxEntries) {
      const oldest = this.#cache.keys().next().value;
      if (oldest !== undefined) this.#cache.delete(oldest);
    }
  }
}
