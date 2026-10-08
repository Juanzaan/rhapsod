export interface InnertubePlayerOptions {
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

interface InnertubeFormat {
  readonly bitrate?: number;
  readonly itag?: number;
  readonly mimeType?: string;
  readonly url?: string;
}

interface InnertubePlayerResponse {
  readonly playabilityStatus?: { readonly status?: string };
  readonly streamingData?: {
    readonly adaptiveFormats?: readonly InnertubeFormat[];
  };
  readonly videoDetails?: {
    readonly isLive?: boolean;
    readonly isLiveContent?: boolean;
    readonly lengthSeconds?: string;
    readonly title?: string;
    readonly videoId?: string;
  };
}

export type InnertubeClientName = "android-vr" | "visionos";

export interface InnertubePlayerAudio {
  readonly audioUrl: string;
  readonly client: InnertubeClientName;
}

export interface InnertubePlayerTrack extends InnertubePlayerAudio {
  readonly durationSeconds: number;
  readonly title: string;
}

interface InnertubeClient {
  readonly context: Record<string, unknown>;
  readonly headers: Record<string, string>;
  readonly key?: string;
  readonly name: InnertubeClientName;
}

// Only clients whose formats carry a plain `url`: TV, MWEB and WEB return
// ciphered URLs that need YouTube's player JS to decode, which the bot does not
// run. VISIONOS mirrors yt-dlp's JS-less default and covers ANDROID_VR when
// YouTube enforces PO tokens or SABR on it.
const INNERTUBE_CLIENTS: readonly InnertubeClient[] = [
  {
    context: {
      androidSdkVersion: 30,
      clientName: "ANDROID_VR",
      clientVersion: "1.58.0",
      gl: "US",
      hl: "en",
    },
    headers: {
      "user-agent": "com.google.android.apps.youtube.vr.oculus/1.58.0",
    },
    key: "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w",
    name: "android-vr",
  },
  {
    context: {
      clientName: "VISIONOS",
      clientVersion: "1.02",
      deviceMake: "Apple",
      deviceModel: "RealityDevice17,1",
      gl: "US",
      hl: "en",
      osName: "visionOS",
      osVersion: "26.5.23O471",
    },
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
      "x-youtube-client-name": "101",
      "x-youtube-client-version": "1.02",
    },
    name: "visionos",
  },
];
const DEFAULT_TIMEOUT_MS = 5_000;

export async function fetchInnertubePlayerAudioUrl(
  videoId: string,
  options: InnertubePlayerOptions = {},
): Promise<InnertubePlayerAudio | undefined> {
  const result = await fetchPlayableResponse(videoId, options);
  return result === undefined
    ? undefined
    : { audioUrl: result.audioUrl, client: result.client };
}

/**
 * Title, duration and audio URL from the one player request, so a pasted link
 * does not wait for a yt-dlp process just to read its title. Live streams and
 * anything without a plain audio URL return undefined and keep the yt-dlp path.
 */
export async function fetchInnertubePlayerTrack(
  videoId: string,
  options: InnertubePlayerOptions = {},
): Promise<InnertubePlayerTrack | undefined> {
  const result = await fetchPlayableResponse(videoId, options);
  const details = result?.body.videoDetails;
  if (result === undefined || details === undefined) return undefined;
  if (details.isLive === true || details.isLiveContent === true)
    return undefined;
  if (details.videoId !== undefined && details.videoId !== videoId)
    return undefined;
  const title = details.title?.trim();
  const durationSeconds = Number(details.lengthSeconds);
  if (!title || !Number.isInteger(durationSeconds) || durationSeconds <= 0)
    return undefined;
  return {
    audioUrl: result.audioUrl,
    client: result.client,
    durationSeconds,
    title,
  };
}

// A client that answers without a usable URL moves on to the next one; a
// timeout or abort ends the chain, so the worst case before the yt-dlp
// fallback stays at one timeout.
async function fetchPlayableResponse(
  videoId: string,
  options: InnertubePlayerOptions,
): Promise<
  | (InnertubePlayerAudio & { readonly body: InnertubePlayerResponse })
  | undefined
> {
  for (const client of INNERTUBE_CLIENTS) {
    const attempt = await fetchPlayerResponse(videoId, client, options);
    if (attempt === "stop") return undefined;
    const audioUrl =
      attempt === undefined ? undefined : preferredAudioUrl(attempt);
    if (attempt !== undefined && audioUrl !== undefined)
      return { audioUrl, body: attempt, client: client.name };
  }
  return undefined;
}

async function fetchPlayerResponse(
  videoId: string,
  client: InnertubeClient,
  options: InnertubePlayerOptions,
): Promise<InnertubePlayerResponse | "stop" | undefined> {
  if (options.signal?.aborted) return "stop";
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref();
  const signal =
    options.signal === undefined
      ? controller.signal
      : AbortSignal.any([options.signal, controller.signal]);
  const query =
    client.key === undefined
      ? "prettyPrint=false"
      : `key=${encodeURIComponent(client.key)}&prettyPrint=false`;
  try {
    const response = await fetchImpl(
      `https://www.youtube.com/youtubei/v1/player?${query}`,
      {
        body: JSON.stringify({
          context: { client: client.context },
          videoId,
        }),
        headers: {
          "content-type": "application/json",
          ...client.headers,
        },
        method: "POST",
        signal,
      },
    );
    if (!response.ok) return undefined;
    const body = (await response.json()) as InnertubePlayerResponse;
    return body.playabilityStatus?.status === "OK" ? body : undefined;
  } catch {
    return signal.aborted ? "stop" : undefined;
  } finally {
    clearTimeout(timer);
  }
}

function preferredAudioUrl(body: InnertubePlayerResponse): string | undefined {
  const formats = body.streamingData?.adaptiveFormats ?? [];
  const audio = formats.filter(
    (format) =>
      typeof format.url === "string" &&
      typeof format.mimeType === "string" &&
      format.mimeType.startsWith("audio/"),
  );
  if (audio.length === 0) return undefined;
  const preferred =
    audio.find((format) => format.itag === 251) ??
    [...audio].sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
  const url = preferred?.url;
  return url && /^https:\/\//i.test(url) ? url : undefined;
}
