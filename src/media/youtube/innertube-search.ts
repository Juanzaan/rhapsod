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
const WEB_REMIX_CLIENT = {
  clientName: "WEB_REMIX",
  clientVersion: "1.20250728.01.00",
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

export async function searchInnertubeMusicVideos(
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
      `https://music.youtube.com/youtubei/v1/search?key=${encodeURIComponent(WEB_API_KEY)}&prettyPrint=false`,
      {
        body: JSON.stringify({
          context: { client: WEB_REMIX_CLIENT },
          // EgWKAQIIAWoQEAMQBBAJEAoQBRAREBAQFQ== = filter songs
          params: "EgWKAQIIAWoQEAMQBBAJEAoQBRAREBAQFQ==",
          query,
        }),
        headers: {
          "content-type": "application/json",
          origin: "https://music.youtube.com",
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        },
        method: "POST",
        signal: controller.signal,
      },
    );
    if (!response.ok) return [];
    const body = await response.json();
    const results = parseInnertubeMusicSearch(body);
    if (results.length > 0) return results.slice(0, maxResults);
    return [];
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

function parseInnertubeMusicSearch(
  body: unknown,
): readonly InnertubeSearchResult[] {
  const results: InnertubeSearchResult[] = [];
  const root = body as Record<string, unknown>;
  const contents = root.contents as Record<string, unknown> | undefined;
  const tabbed = contents?.tabbedSearchResultsRenderer as
    Record<string, unknown> | undefined;
  const tabs = Array.isArray(tabbed?.tabs) ? (tabbed.tabs as unknown[]) : [];
  const sectionLists: Array<Record<string, unknown>> = [];
  for (const tab of tabs) {
    const tabRenderer = (tab as Record<string, unknown>).tabRenderer as
      Record<string, unknown> | undefined;
    const content = tabRenderer?.content as Record<string, unknown> | undefined;
    const sl = content?.sectionListRenderer as
      Record<string, unknown> | undefined;
    if (sl) sectionLists.push(sl);
  }
  const directSl = contents?.sectionListRenderer as
    Record<string, unknown> | undefined;
  if (directSl) sectionLists.push(directSl);

  for (const sectionList of sectionLists) {
    const sections = Array.isArray(sectionList.contents)
      ? (sectionList.contents as unknown[])
      : [];
    for (const section of sections) {
      const rec = section as Record<string, unknown>;
      const musicShelf = rec.musicShelfRenderer as
        Record<string, unknown> | undefined;
      if (musicShelf && Array.isArray(musicShelf.contents)) {
        for (const item of musicShelf.contents as unknown[]) {
          const r = item as Record<string, unknown>;
          const mrlir = r.musicResponsiveListItemRenderer as
            Record<string, unknown> | undefined;
          if (mrlir) {
            const parsed = parseMusicResponsiveListItem(mrlir);
            if (parsed) results.push(parsed);
            continue;
          }
          const mrhir = r.musicCardShelfRenderer as
            Record<string, unknown> | undefined;
          if (mrhir) {
            const header = mrhir.header as Record<string, unknown> | undefined;
            const card = header?.musicCardShelfHeaderBasicRenderer as
              Record<string, unknown> | undefined;
            if (card) {
              const nav = card.navigationEndpoint as
                Record<string, unknown> | undefined;
              const watch = nav?.watchEndpoint as
                Record<string, unknown> | undefined;
              const vid = watch?.videoId;
              const title = textOf(card.title);
              if (typeof vid === "string" && vid && title) {
                results.push({ id: vid, title });
              }
            }
          }
        }
        continue;
      }
      const itemSection = rec.itemSectionRenderer as
        Record<string, unknown> | undefined;
      if (itemSection && Array.isArray(itemSection.contents)) {
        for (const item of itemSection.contents as unknown[]) {
          const r = item as Record<string, unknown>;
          const video = r.videoRenderer as Record<string, unknown> | undefined;
          if (video) {
            const id = video.videoId;
            const title = textOf(video.title);
            if (typeof id === "string" && id && title) {
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
            continue;
          }
          const mrlir = r.musicResponsiveListItemRenderer as
            Record<string, unknown> | undefined;
          if (mrlir) {
            const parsed = parseMusicResponsiveListItem(mrlir);
            if (parsed) results.push(parsed);
          }
        }
      }
    }
  }
  return results;
}

function parseMusicResponsiveListItem(
  renderer: Record<string, unknown>,
): InnertubeSearchResult | undefined {
  let videoId: string | undefined;
  const nav = renderer.navigationEndpoint as
    Record<string, unknown> | undefined;
  const watch = nav?.watchEndpoint as Record<string, unknown> | undefined;
  if (typeof watch?.videoId === "string") videoId = watch.videoId;

  if (!videoId) {
    const overlay = renderer.overlay as Record<string, unknown> | undefined;
    const mitr = overlay?.musicItemThumbnailOverlayRenderer as
      Record<string, unknown> | undefined;
    const content = mitr?.content as Record<string, unknown> | undefined;
    const playBtn = content?.musicPlayButtonRenderer as
      Record<string, unknown> | undefined;
    const playNav = playBtn?.playNavigationEndpoint as
      Record<string, unknown> | undefined;
    const playWatch = playNav?.watchEndpoint as
      Record<string, unknown> | undefined;
    if (typeof playWatch?.videoId === "string")
      videoId = playWatch.videoId;
  }

  if (!videoId && Array.isArray(renderer.flexColumns)) {
    for (const col of renderer.flexColumns as unknown[]) {
      const fc = (col as Record<string, unknown>)
        .musicResponsiveListItemFlexColumnRenderer as
        Record<string, unknown> | undefined;
      const text = fc?.text as Record<string, unknown> | undefined;
      const runs = text?.runs;
      if (Array.isArray(runs)) {
        for (const run of runs as unknown[]) {
          const runRec = run as Record<string, unknown>;
          const nav2 = runRec.navigationEndpoint as
            Record<string, unknown> | undefined;
          const w2 = nav2?.watchEndpoint as Record<string, unknown> | undefined;
          if (typeof w2?.videoId === "string") {
            videoId = w2.videoId;
            break;
          }
        }
      }
      if (videoId) break;
    }
  }

  if (typeof videoId !== "string" || videoId.length === 0) return undefined;

  const flexColumns = renderer.flexColumns;
  if (!Array.isArray(flexColumns) || flexColumns.length === 0) return undefined;
  const firstCol = (flexColumns[0] as Record<string, unknown>)
    .musicResponsiveListItemFlexColumnRenderer as
    Record<string, unknown> | undefined;
  const title = textOf(firstCol?.text);
  if (!title) return undefined;

  let channel: string | undefined;
  if (flexColumns.length > 1) {
    const secondCol = (flexColumns[1] as Record<string, unknown>)
      .musicResponsiveListItemFlexColumnRenderer as
      Record<string, unknown> | undefined;
    const secondText = secondCol?.text as Record<string, unknown> | undefined;
    const runs = secondText?.runs;
    if (Array.isArray(runs) && runs.length > 0) {
      const firstRun = (runs[0] as Record<string, unknown>).text;
      if (typeof firstRun === "string" && firstRun.length > 0) {
        if (firstRun.toLowerCase().includes("song") && runs.length > 2) {
          const ch = (runs[2] as Record<string, unknown>).text;
          if (typeof ch === "string" && ch.length > 0) channel = ch;
        } else {
          channel = firstRun;
        }
      }
    }
    if (channel === "Song" || channel === "Video") channel = undefined;
  }

  let durationSeconds: number | undefined;
  const allRuns: string[] = [];
  for (const col of flexColumns as unknown[]) {
    const fc = (col as Record<string, unknown>)
      .musicResponsiveListItemFlexColumnRenderer as
      Record<string, unknown> | undefined;
    if (fc?.text) allRuns.push(textOf(fc.text));
  }
  const fixed = renderer.fixedColumns;
  if (Array.isArray(fixed)) {
    for (const col of fixed as unknown[]) {
      const fc = (col as Record<string, unknown>)
        .musicResponsiveListItemFixedColumnRenderer as
        Record<string, unknown> | undefined;
      if (fc?.text) allRuns.push(textOf(fc.text));
    }
  }
  for (const runText of allRuns) {
    const secs = lengthSeconds({ simpleText: runText });
    if (secs !== undefined) {
      durationSeconds = secs;
      break;
    }
    const m = runText.match(/(\d+):(\d+)(?::(\d+))?/);
    if (m) {
      const parsed = lengthSeconds({ simpleText: m[0] });
      if (parsed !== undefined) {
        durationSeconds = parsed;
        break;
      }
    }
  }

  return {
    ...(channel === undefined ? {} : { channel }),
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
    id: videoId,
    title,
  };
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
