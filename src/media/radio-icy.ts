import { safeFetch } from "../lib/ssrf.js";

export interface IcyFetchOptions {
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly userAgent?: string;
}

const DEFAULT_TIMEOUT_MS = 6_000;
const DEFAULT_TTL_MS = 30_000;
const MAX_METADATA_BLOCKS = 3;

// Response bodies come from undici while this project compiles without DOM
// stream-result typings (lib ES2023), so the slice we use is structural.
interface IcyBodyReader {
  cancel(): Promise<void>;
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
}

export function parseIcyStreamTitle(block: Uint8Array): string | undefined {
  const text = new TextDecoder("utf-8").decode(block);
  const title = /StreamTitle='([^']*)'/.exec(text)?.[1];
  if (title === undefined || title.length === 0) return undefined;
  return title;
}

// Reads the live song title of an icecast/shoutcast stream (StreamTitle).
// Best-effort display helper: returns undefined when the server sends no
// ICY metadata or anything fails, and never throws.
export async function fetchIcyTitle(
  url: string,
  options: IcyFetchOptions = {},
): Promise<string | undefined> {
  const fetchImpl = options.fetch ?? safeFetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("ICY request timed out"));
    }, timeoutMs);
    timer.unref();
  });
  try {
    const response = await Promise.race([
      fetchImpl(url, {
        headers: {
          "Icy-MetaData": "1",
          "User-Agent": options.userAgent ?? "Rhapsod/3.0",
        },
        redirect: "follow",
        signal: controller.signal,
      }),
      timeout,
    ]);
    const metaint = Number(response.headers.get("icy-metaint"));
    if (
      !Number.isSafeInteger(metaint) ||
      metaint <= 0 ||
      response.body === null
    ) {
      return undefined;
    }
    const reader = response.body.getReader() as unknown as IcyBodyReader;
    try {
      let buffered = new Uint8Array(0);
      let base = 0;
      for (let attempt = 0; attempt < MAX_METADATA_BLOCKS; attempt++) {
        while (buffered.length <= base + metaint) {
          const read = await reader.read();
          if (read.done) return undefined;
          if (read.value === undefined) continue;
          const merged = new Uint8Array(buffered.length + read.value.length);
          merged.set(buffered);
          merged.set(read.value, buffered.length);
          buffered = merged;
        }
        const metaLength = buffered[base + metaint]! * 16;
        const block = buffered.slice(
          base + metaint + 1,
          base + metaint + 1 + metaLength,
        );
        base += metaint + 1 + metaLength;
        const title = parseIcyStreamTitle(block);
        if (title !== undefined) return title;
      }
      return undefined;
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  } catch {
    return undefined;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// TTL cache with in-flight dedupe so chat (!np) and the panel dashboard
// share one lightweight poll per live stream instead of hammering it.
export class RadioTitleCache {
  readonly #titles = new Map<
    string,
    { expiresAt: number; title: string | undefined }
  >();
  readonly #inflight = new Map<string, Promise<string | undefined>>();
  readonly #fetch: typeof fetch | undefined;
  readonly #timeoutMs: number | undefined;
  readonly #ttlMs: number;

  constructor(
    options: {
      fetch?: typeof fetch;
      timeoutMs?: number;
      ttlMs?: number;
    } = {},
  ) {
    this.#fetch = options.fetch;
    this.#timeoutMs = options.timeoutMs;
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  }

  peek(url: string): string | undefined {
    return this.#fresh(url)?.title;
  }

  get(url: string): Promise<string | undefined> {
    const entry = this.#fresh(url);
    if (entry !== undefined) return Promise.resolve(entry.title);
    const ongoing = this.#inflight.get(url);
    if (ongoing !== undefined) return ongoing;
    const pending = fetchIcyTitle(url, {
      ...(this.#fetch === undefined ? {} : { fetch: this.#fetch }),
      ...(this.#timeoutMs === undefined ? {} : { timeoutMs: this.#timeoutMs }),
    }).then((title) => {
      this.#titles.set(url, { expiresAt: Date.now() + this.#ttlMs, title });
      return title;
    });
    const tracked = pending.finally(() => {
      if (this.#inflight.get(url) === tracked) this.#inflight.delete(url);
    });
    this.#inflight.set(url, tracked);
    return tracked;
  }

  #fresh(url: string): { title: string | undefined } | undefined {
    const cached = this.#titles.get(url);
    return cached !== undefined && cached.expiresAt > Date.now()
      ? cached
      : undefined;
  }
}
