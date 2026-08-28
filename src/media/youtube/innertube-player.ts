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
    if (body.playabilityStatus?.status !== "OK") return undefined;
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
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
