export interface InnertubeSearchResult {
  readonly channel?: string;
  readonly durationSeconds?: number;
  readonly id: string;
  readonly title: string;
}

export interface InnertubeSearchOptions {
  readonly fetchImpl?: typeof fetch;
  readonly maxResults?: number;
  readonly timeoutMs?: number;
}

const WEB_API_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const WEB_CLIENT = {
  clientName: "WEB",
  clientVersion: "2.20260101.00.00",
  gl: "US",
  hl: "en",
};
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_RESULTS = 15;

export async function searchInnertubeVideos(
  query: string,
  options: InnertubeSearchOptions = {},
): Promise<readonly InnertubeSearchResult[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref();
  try {
    const response = await fetchImpl(
      `https://www.youtube.com/youtubei/v1/search?key=${encodeURIComponent(WEB_API_KEY)}&prettyPrint=false`,
      {
        body: JSON.stringify({ context: { client: WEB_CLIENT }, query }),
        headers: {
          "content-type": "application/json",
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        },
        method: "POST",
        signal: controller.signal,
      },
    );
    if (!response.ok) return [];
    const body = await response.json();
    return parseInnertubeSearch(body).slice(0, maxResults);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function parseInnertubeSearch(body: unknown): readonly InnertubeSearchResult[] {
  const results: InnertubeSearchResult[] = [];
  const root = body as Record<string, unknown>;
  const contents = root.contents as Record<string, unknown> | undefined;
  const twoColumn = contents?.twoColumnSearchResultsRenderer as
    Record<string, unknown> | undefined;
  const primary = twoColumn?.primaryContents as
    Record<string, unknown> | undefined;
  const sectionList = primary?.sectionListRenderer as
    Record<string, unknown> | undefined;
  const sections = Array.isArray(sectionList?.contents)
    ? (sectionList.contents as unknown[])
    : [];
  for (const section of sections) {
    const sectionRecord = section as Record<string, unknown>;
    const items = (sectionRecord.itemSectionRenderer as Record<string, unknown>)
      ?.contents;
    if (!Array.isArray(items)) continue;
    for (const item of items as unknown[]) {
      const video = (item as Record<string, unknown>).videoRenderer as
        Record<string, unknown> | undefined;
      if (video === undefined) continue;
      const id = video.videoId;
      const title = textOf(video.title);
      if (typeof id !== "string" || id.length === 0 || title.length === 0) {
        continue;
      }
      results.push({
        ...(channelOf(video) === undefined
          ? {}
          : { channel: channelOf(video)! }),
        ...(lengthSeconds(video.lengthText) === undefined
          ? {}
          : { durationSeconds: lengthSeconds(video.lengthText)! }),
        id,
        title,
      });
    }
  }
  return results;
}

function textOf(value: unknown): string {
  const record = value as Record<string, unknown> | undefined;
  if (record === undefined) return "";
  if (typeof record.simpleText === "string") return record.simpleText;
  if (Array.isArray(record.runs)) {
    return (record.runs as unknown[])
      .map((run) => (run as Record<string, unknown>).text)
      .filter((text): text is string => typeof text === "string")
      .join("");
  }
  return "";
}

function channelOf(video: Record<string, unknown>): string | undefined {
  const ownerText = video.ownerText as Record<string, unknown> | undefined;
  const runs = ownerText?.runs;
  if (Array.isArray(runs) && runs.length > 0) {
    const first = (runs[0] as Record<string, unknown>).text;
    if (typeof first === "string" && first.length > 0) return first;
  }
  return undefined;
}

function lengthSeconds(value: unknown): number | undefined {
  const text = textOf(value);
  const match = text.match(/^(?:(\d+):)?(\d+):(\d+)$/);
  if (match === null) return undefined;
  const hours = match[1] === undefined ? 0 : Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  return hours * 3600 + minutes * 60 + seconds;
}
