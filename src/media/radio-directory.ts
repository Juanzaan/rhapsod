import { safeFetch } from "../lib/ssrf.js";
import { rhapsodUserAgent } from "../lib/version.js";

export interface RadioStation {
  readonly bitrate?: number;
  readonly codec?: string;
  readonly country?: string;
  readonly name: string;
  readonly tags?: string;
  readonly url: string;
  readonly votes: number;
}

export interface StationSearchOptions {
  readonly fetch?: typeof fetch;
  /** Mirror hostnames to try in order; skips discovery (tests). */
  readonly mirrors?: readonly string[];
  readonly limit?: number;
  readonly timeoutMs?: number;
  readonly userAgent?: string;
}

const DISCOVERY_URL = "https://all.api.radio-browser.info/json/servers";
// Used only when discovery itself fails.
const FALLBACK_MIRRORS = [
  "de1.api.radio-browser.info",
  "de2.api.radio-browser.info",
  "fi1.api.radio-browser.info",
];
const MIRROR_TTL_MS = 60 * 60 * 1_000;
const MAX_MIRROR_ATTEMPTS = 3;
const DEFAULT_TIMEOUT_MS = 8_000;

let mirrorCache: { hosts: string[]; expiresAt: number } | undefined;

/** Test seam: forget discovered mirrors. */
export function resetRadioMirrorCache(): void {
  mirrorCache = undefined;
}

// Community radio directory (radio-browser.info): search stations by name,
// tag or country, top voted first. The project asks clients to discover its
// mirrors and spread load across them instead of pinning one; with de1
// pinned, !radio found nothing whenever that one mirror was down. The list comes from
// /json/servers, is cached for an hour and shuffled, and a failed mirror
// moves the search to the next one. Returns [] on any failure so callers
// report "not found" instead of crashing; never throws.
export async function searchStations(
  query: string,
  options: StationSearchOptions = {},
): Promise<readonly RadioStation[]> {
  const fetchImpl = options.fetch ?? safeFetch;
  const limit = Math.max(1, Math.min(options.limit ?? 5, 10));
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Radio directory request timed out"));
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    timer.unref();
  });
  // The timer can fire while no race is awaiting it (inside response.json).
  timeout.catch(() => undefined);
  const userAgent =
    options.userAgent ??
    rhapsodUserAgent("+https://github.com/Juanzaan/rhapsod");
  try {
    const hosts =
      options.mirrors ??
      (await Promise.race([
        discoverMirrors(fetchImpl, userAgent, controller.signal),
        timeout,
      ]));
    for (const host of hosts.slice(0, MAX_MIRROR_ATTEMPTS)) {
      const endpoint =
        `https://${host}/json/stations/search?name=${encodeURIComponent(query)}` +
        `&limit=${limit}&order=votes&reverse=true&hidebroken=true`;
      let body: unknown;
      try {
        const response = await Promise.race([
          fetchImpl(endpoint, {
            headers: { "User-Agent": userAgent },
            signal: controller.signal,
          }),
          timeout,
        ]);
        if (!response.ok) continue;
        body = await response.json();
      } catch (error) {
        if (controller.signal.aborted) throw error;
        continue;
      }
      if (!Array.isArray(body)) continue;
      const stations: RadioStation[] = [];
      for (const item of body) {
        const parsed = parseStation(item);
        if (parsed !== undefined) stations.push(parsed);
      }
      return stations;
    }
    return [];
  } catch {
    return [];
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function discoverMirrors(
  fetchImpl: typeof fetch,
  userAgent: string,
  signal: AbortSignal,
): Promise<readonly string[]> {
  if (mirrorCache !== undefined && mirrorCache.expiresAt > Date.now()) {
    return shuffle(mirrorCache.hosts);
  }
  try {
    const response = await fetchImpl(DISCOVERY_URL, {
      headers: { "User-Agent": userAgent },
      signal,
    });
    const body: unknown = response.ok ? await response.json() : undefined;
    const hosts = Array.isArray(body)
      ? [
          ...new Set(
            body
              .map((entry) =>
                typeof entry === "object" && entry !== null
                  ? (entry as { name?: unknown }).name
                  : undefined,
              )
              .filter(
                (name): name is string =>
                  typeof name === "string" &&
                  /^[a-z0-9-]+\.api\.radio-browser\.info$/i.test(name),
              ),
          ),
        ]
      : [];
    if (hosts.length > 0) {
      mirrorCache = { expiresAt: Date.now() + MIRROR_TTL_MS, hosts };
      return shuffle(hosts);
    }
  } catch {
    // Fall through to the built-in list; the search itself may still work.
  }
  return shuffle(FALLBACK_MIRRORS);
}

function shuffle(hosts: readonly string[]): string[] {
  const copy = [...hosts];
  for (let index = copy.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[other]] = [copy[other]!, copy[index]!];
  }
  return copy;
}

function parseStation(raw: unknown): RadioStation | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  if (typeof record.name !== "string" || record.name.length === 0)
    return undefined;
  const url =
    typeof record.url_resolved === "string" && record.url_resolved.length > 0
      ? record.url_resolved
      : typeof record.url === "string" && record.url.length > 0
        ? record.url
        : undefined;
  if (url === undefined) return undefined;
  return {
    ...(typeof record.bitrate === "number" && Number.isFinite(record.bitrate)
      ? { bitrate: Math.round(record.bitrate) }
      : {}),
    ...(typeof record.codec === "string" && record.codec.length > 0
      ? { codec: record.codec }
      : {}),
    ...(typeof record.country === "string" && record.country.length > 0
      ? { country: record.country }
      : {}),
    ...(typeof record.tags === "string" && record.tags.length > 0
      ? { tags: record.tags }
      : {}),
    name: record.name,
    url,
    votes:
      typeof record.votes === "number" && Number.isFinite(record.votes)
        ? Math.round(record.votes)
        : 0,
  };
}
