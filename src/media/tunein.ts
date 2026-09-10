import { safeFetch } from "../lib/ssrf.js";

export interface TuneInStation {
  readonly bitrate?: number;
  readonly id: string;
  readonly name: string;
}

export interface TuneInSearchOptions {
  readonly fetch?: typeof fetch;
  readonly limit?: number;
  readonly timeoutMs?: number;
  readonly userAgent?: string;
}

const API_BASE = "https://opml.radiotime.com";
const DEFAULT_TIMEOUT_MS = 8_000;
const STATION_ID_RE = /^s\d+$/;

// TuneIn's public OPML directory (no auth): search stations, then resolve a
// station id to a playable stream through its .m3u tune file. Live-verified
// response shapes; anything unexpected yields [] / undefined, never throws.
export async function searchTuneInStations(
  query: string,
  options: TuneInSearchOptions = {},
): Promise<readonly TuneInStation[]> {
  const body = await tuneInRequest<unknown>(
    `/search.ashx?query=${encodeURIComponent(query)}&render=json`,
    options,
  );
  if (typeof body !== "object" || body === null) return [];
  const outlines = (body as { body?: unknown }).body;
  if (!Array.isArray(outlines)) return [];
  const stations: TuneInStation[] = [];
  const limit = Math.max(1, Math.min(options.limit ?? 5, 10));
  for (const outline of outlines) {
    collectStations(outline, stations);
    if (stations.length >= limit) break;
  }
  return stations;
}

function collectStations(raw: unknown, into: TuneInStation[]): void {
  if (typeof raw !== "object" || raw === null) return;
  const record = raw as {
    bitrate?: unknown;
    children?: unknown;
    guide_id?: unknown;
    text?: unknown;
    type?: unknown;
  };
  if (Array.isArray(record.children)) {
    for (const child of record.children) collectStations(child, into);
  }
  if (record.type !== "audio") return;
  if (typeof record.text !== "string" || record.text.length === 0) return;
  if (
    typeof record.guide_id !== "string" ||
    !STATION_ID_RE.test(record.guide_id)
  ) {
    return;
  }
  into.push({
    ...(typeof record.bitrate === "number" && Number.isFinite(record.bitrate)
      ? { bitrate: Math.round(record.bitrate) }
      : {}),
    id: record.guide_id,
    name: record.text,
  });
}

// Resolves a station id (s12345) to its first HTTPS stream URL from the
// tune .m3u file. Plain http entries are skipped: the player only accepts
// HTTPS, and the directory usually lists both.
export async function resolveTuneInStream(
  stationId: string,
  options: TuneInSearchOptions = {},
): Promise<string | undefined> {
  const text = await tuneInRequestText(
    `/tune.ashx?id=${encodeURIComponent(stationId)}`,
    options,
  );
  if (text === undefined) return undefined;
  for (const line of text.split("\n")) {
    const url = line.trim();
    if (url.toLowerCase().startsWith("https://")) return url;
  }
  return undefined;
}

async function tuneInRequest<T>(
  path: string,
  options: TuneInSearchOptions,
): Promise<T | undefined> {
  const text = await tuneInRequestText(path, options);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

async function tuneInRequestText(
  path: string,
  options: TuneInSearchOptions,
): Promise<string | undefined> {
  const fetchImpl = options.fetch ?? safeFetch;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("TuneIn request timed out"));
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    timer.unref();
  });
  try {
    const response = await Promise.race([
      fetchImpl(`${API_BASE}${path}`, {
        headers: {
          "User-Agent": options.userAgent ?? "Rhapsod/3.0",
        },
        signal: controller.signal,
      }),
      timeout,
    ]);
    if (!response.ok) return undefined;
    return await response.text();
  } catch {
    return undefined;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
