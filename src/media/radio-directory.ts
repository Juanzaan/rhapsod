import { safeFetch } from "../lib/ssrf.js";

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
  readonly limit?: number;
  readonly timeoutMs?: number;
  readonly userAgent?: string;
}

const API_BASE = "https://de1.api.radio-browser.info/json/stations";
const DEFAULT_TIMEOUT_MS = 8_000;

// Community radio directory (radio-browser.info): search stations by name,
// tag or country, top voted first. The project requires a meaningful
// User-Agent and asks clients to pick one mirror; de1 is the default.
// Returns [] on any failure so callers report "not found" instead of
// crashing; never throws.
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
  try {
    const endpoint =
      `${API_BASE}/search?name=${encodeURIComponent(query)}` +
      `&limit=${limit}&order=votes&reverse=true&hidebroken=true`;
    const response = await Promise.race([
      fetchImpl(endpoint, {
        headers: {
          "User-Agent":
            options.userAgent ??
            "Rhapsod/3.0 (+https://github.com/Juanzaan/rhapsod)",
        },
        signal: controller.signal,
      }),
      timeout,
    ]);
    if (!response.ok) return [];
    const body: unknown = await response.json();
    if (!Array.isArray(body)) return [];
    const stations: RadioStation[] = [];
    for (const item of body) {
      const parsed = parseStation(item);
      if (parsed !== undefined) stations.push(parsed);
    }
    return stations;
  } catch {
    return [];
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
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
