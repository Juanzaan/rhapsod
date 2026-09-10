export interface InnertubeRelatedOptions {
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

interface InnertubeNextResponse {
  readonly contents?: {
    readonly twoColumnWatchNextResults?: {
      readonly autoplay?: {
        readonly autoplay?: {
          readonly sets?: readonly unknown[];
        };
      };
    };
  };
}

const WEB_CLIENT = {
  clientName: "WEB",
  clientVersion: "2.20240101.00.00",
  gl: "ES",
  hl: "es",
};
const DEFAULT_TIMEOUT_MS = 8_000;
const VIDEO_ID_RE = /^[\w-]{11}$/;

// YouTube's own "up next" pick for a video, via the keyless Innertube `next`
// endpoint (same WEB client family the probes use, no API key needed).
// Single id, not a pool: the fallback tier when a full mix is unavailable.
// Returns undefined on any failure; never throws.
export async function fetchAutoplayVideoId(
  videoId: string,
  options: InnertubeRelatedOptions = {},
): Promise<string | undefined> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  timer.unref();
  try {
    const response = await fetchImpl(
      "https://www.youtube.com/youtubei/v1/next?prettyPrint=false",
      {
        body: JSON.stringify({
          context: { client: WEB_CLIENT },
          videoId,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: controller.signal,
      },
    );
    if (!response.ok) return undefined;
    const body = (await response.json()) as InnertubeNextResponse;
    const sets =
      body.contents?.twoColumnWatchNextResults?.autoplay?.autoplay?.sets ?? [];
    for (const set of sets) {
      const id = (
        set as { autoplayVideo?: { watchEndpoint?: { videoId?: unknown } } }
      ).autoplayVideo?.watchEndpoint?.videoId;
      if (typeof id === "string" && VIDEO_ID_RE.test(id)) return id;
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
