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

export interface InnertubePlayerTrack {
  readonly audioUrl: string;
  readonly durationSeconds: number;
  readonly title: string;
}

const ANDROID_VR_API_KEY = "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w";
const ANDROID_VR_CLIENT = {
  androidSdkVersion: 30,
  clientName: "ANDROID_VR",
  clientVersion: "1.58.0",
  gl: "US",
  hl: "en",
};
const ANDROID_VR_USER_AGENT =
  "com.google.android.apps.youtube.vr.oculus/1.58.0";
const DEFAULT_TIMEOUT_MS = 5_000;

export async function fetchInnertubePlayerAudioUrl(
  videoId: string,
  options: InnertubePlayerOptions = {},
): Promise<string | undefined> {
  const body = await fetchPlayerResponse(videoId, options);
  return body === undefined ? undefined : preferredAudioUrl(body);
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
  const body = await fetchPlayerResponse(videoId, options);
  const details = body?.videoDetails;
  if (body === undefined || details === undefined) return undefined;
  if (details.isLive === true || details.isLiveContent === true)
    return undefined;
  if (details.videoId !== undefined && details.videoId !== videoId)
    return undefined;
  const title = details.title?.trim();
  const durationSeconds = Number(details.lengthSeconds);
  if (!title || !Number.isInteger(durationSeconds) || durationSeconds <= 0)
    return undefined;
  const audioUrl = preferredAudioUrl(body);
  return audioUrl === undefined
    ? undefined
    : { audioUrl, durationSeconds, title };
}

async function fetchPlayerResponse(
  videoId: string,
  options: InnertubePlayerOptions,
): Promise<InnertubePlayerResponse | undefined> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref();
  const signal =
    options.signal === undefined
      ? controller.signal
      : AbortSignal.any([options.signal, controller.signal]);
  try {
    const response = await fetchImpl(
      `https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(ANDROID_VR_API_KEY)}&prettyPrint=false`,
      {
        body: JSON.stringify({
          context: { client: ANDROID_VR_CLIENT },
          videoId,
        }),
        headers: {
          "content-type": "application/json",
          "user-agent": ANDROID_VR_USER_AGENT,
        },
        method: "POST",
        signal,
      },
    );
    if (!response.ok) return undefined;
    const body = (await response.json()) as InnertubePlayerResponse;
    return body.playabilityStatus?.status === "OK" ? body : undefined;
  } catch {
    return undefined;
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
