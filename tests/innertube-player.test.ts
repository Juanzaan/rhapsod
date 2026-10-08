import { describe, expect, it, vi } from "vitest";

import {
  fetchInnertubePlayerAudioUrl,
  fetchInnertubePlayerTrack,
} from "../src/media/youtube/innertube-player.js";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    json: () => body,
  } as unknown as Response;
}

describe("fetchInnertubePlayerAudioUrl", () => {
  it("returns the preferred 251 (opus) audio URL when playable", async () => {
    const fetchImpl = ((input: string | URL) => {
      expect(String(input)).toContain("youtubei/v1/player");
      return jsonResponse(200, {
        playabilityStatus: { status: "OK" },
        streamingData: {
          adaptiveFormats: [
            {
              bitrate: 50_152,
              itag: 139,
              mimeType: 'audio/mp4; codecs="mp4a.40.5"',
              url: "https://googlevideo.example/139",
            },
            {
              bitrate: 160_000,
              itag: 251,
              mimeType: 'audio/webm; codecs="opus"',
              url: "https://googlevideo.example/251",
            },
          ],
        },
      });
    }) as unknown as typeof fetch;
    expect(await fetchInnertubePlayerAudioUrl("abc", { fetchImpl })).toEqual({
      audioUrl: "https://googlevideo.example/251",
      client: "android-vr",
    });
  });

  it("uses the highest-bitrate audio when 251 is absent", async () => {
    const fetchImpl = (() =>
      jsonResponse(200, {
        playabilityStatus: { status: "OK" },
        streamingData: {
          adaptiveFormats: [
            {
              bitrate: 50_152,
              itag: 139,
              mimeType: "audio/mp4",
              url: "https://googlevideo.example/139",
            },
            {
              bitrate: 256_000,
              itag: 141,
              mimeType: "audio/mp4",
              url: "https://googlevideo.example/141",
            },
          ],
        },
      })) as unknown as typeof fetch;
    expect(await fetchInnertubePlayerAudioUrl("abc", { fetchImpl })).toEqual({
      audioUrl: "https://googlevideo.example/141",
      client: "android-vr",
    });
  });

  it("returns undefined when the video is not playable", async () => {
    const fetchImpl = (() =>
      jsonResponse(200, {
        playabilityStatus: { status: "LOGIN_REQUIRED" },
      })) as unknown as typeof fetch;
    expect(
      await fetchInnertubePlayerAudioUrl("abc", { fetchImpl }),
    ).toBeUndefined();
  });

  it("returns undefined when there are no plain audio URLs", async () => {
    const fetchImpl = (() =>
      jsonResponse(200, {
        playabilityStatus: { status: "OK" },
        streamingData: {
          adaptiveFormats: [
            {
              itag: 137,
              mimeType: "video/mp4",
              url: "https://googlevideo.example/137",
            },
            {
              itag: 140,
              mimeType: "audio/mp4",
              signatureCipher: "s=abc",
            },
          ],
        },
      })) as unknown as typeof fetch;
    expect(
      await fetchInnertubePlayerAudioUrl("abc", { fetchImpl }),
    ).toBeUndefined();
  });

  it("returns undefined on HTTP errors", async () => {
    const fetchImpl = (() => jsonResponse(403, {})) as unknown as typeof fetch;
    expect(
      await fetchInnertubePlayerAudioUrl("abc", { fetchImpl }),
    ).toBeUndefined();
  });

  it("returns undefined when the fetch throws", async () => {
    const fetchImpl = (() => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    expect(
      await fetchInnertubePlayerAudioUrl("abc", { fetchImpl }),
    ).toBeUndefined();
  });

  it("honors an external abort signal by rejecting the request", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(() => jsonResponse(200, {}));
    const promise = fetchInnertubePlayerAudioUrl("abc", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      signal: controller.signal,
    });
    controller.abort();
    await new Promise((resolve) => setImmediate(resolve));
    expect(await promise).toBeUndefined();
  });

  it("tries VISIONOS when ANDROID_VR has no plain audio URL", async () => {
    const clients: string[] = [];
    const fetchImpl = ((_input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as {
        context: { client: { clientName: string } };
      };
      const clientName = body.context.client.clientName;
      clients.push(clientName);
      if (clientName === "ANDROID_VR")
        return jsonResponse(200, {
          playabilityStatus: { status: "OK" },
          streamingData: {
            adaptiveFormats: [
              { itag: 251, mimeType: "audio/webm", signatureCipher: "s=x" },
            ],
          },
        });
      return jsonResponse(200, {
        playabilityStatus: { status: "OK" },
        streamingData: {
          adaptiveFormats: [
            {
              itag: 251,
              mimeType: "audio/webm",
              url: "https://googlevideo.example/visionos",
            },
          ],
        },
      });
    }) as unknown as typeof fetch;
    expect(await fetchInnertubePlayerAudioUrl("abc", { fetchImpl })).toEqual({
      audioUrl: "https://googlevideo.example/visionos",
      client: "visionos",
    });
    expect(clients).toEqual(["ANDROID_VR", "VISIONOS"]);
  });

  it("tries VISIONOS after an HTTP error from ANDROID_VR", async () => {
    const urls: string[] = [];
    const fetchImpl = ((input: string | URL) => {
      urls.push(String(input));
      return urls.length === 1
        ? jsonResponse(403, {})
        : jsonResponse(200, {
            playabilityStatus: { status: "OK" },
            streamingData: {
              adaptiveFormats: [
                {
                  itag: 251,
                  mimeType: "audio/webm",
                  url: "https://googlevideo.example/251",
                },
              ],
            },
          });
    }) as unknown as typeof fetch;
    expect(
      (await fetchInnertubePlayerAudioUrl("abc", { fetchImpl }))?.client,
    ).toBe("visionos");
    expect(urls[0]).toContain("key=");
    expect(urls[1]).not.toContain("key=");
  });

  it("stops the client chain after a timeout", async () => {
    const fetchImpl = vi.fn(
      (_input: string | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    );
    expect(
      await fetchInnertubePlayerAudioUrl("abc", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        timeoutMs: 10,
      }),
    ).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("ignores a non-HTTPS preferred audio URL", async () => {
    const fetchImpl = (() =>
      jsonResponse(200, {
        playabilityStatus: { status: "OK" },
        streamingData: {
          adaptiveFormats: [
            {
              bitrate: 160_000,
              itag: 251,
              mimeType: 'audio/webm; codecs="opus"',
              url: "http://googlevideo.example/251",
            },
          ],
        },
      })) as unknown as typeof fetch;
    expect(
      await fetchInnertubePlayerAudioUrl("abc", { fetchImpl }),
    ).toBeUndefined();
  });

  it("rejects an empty preferred audio URL", async () => {
    const fetchImpl = (() =>
      jsonResponse(200, {
        playabilityStatus: { status: "OK" },
        streamingData: {
          adaptiveFormats: [
            {
              itag: 251,
              mimeType: "audio/webm",
            },
          ],
        },
      })) as unknown as typeof fetch;
    expect(
      await fetchInnertubePlayerAudioUrl("abc", { fetchImpl }),
    ).toBeUndefined();
  });
});

describe("fetchInnertubePlayerTrack", () => {
  const audioFormats = {
    adaptiveFormats: [
      {
        bitrate: 160_000,
        itag: 251,
        mimeType: 'audio/webm; codecs="opus"',
        url: "https://googlevideo.example/251",
      },
    ],
  };
  const fetchWith = (videoDetails: unknown) =>
    (() =>
      jsonResponse(200, {
        playabilityStatus: { status: "OK" },
        streamingData: audioFormats,
        videoDetails,
      })) as unknown as typeof fetch;

  it("returns title, duration and audio URL from one request", async () => {
    const fetchImpl = fetchWith({
      lengthSeconds: "215",
      title: " Song title ",
      videoId: "abc",
    });
    expect(await fetchInnertubePlayerTrack("abc", { fetchImpl })).toEqual({
      audioUrl: "https://googlevideo.example/251",
      client: "android-vr",
      durationSeconds: 215,
      title: "Song title",
    });
  });

  it("leaves live streams to yt-dlp", async () => {
    const fetchImpl = fetchWith({
      isLive: true,
      isLiveContent: true,
      lengthSeconds: "0",
      title: "Radio 24/7",
      videoId: "abc",
    });
    expect(await fetchInnertubePlayerTrack("abc", { fetchImpl })).toBe(
      undefined,
    );
  });

  it("rejects a response for another video or without a duration", async () => {
    expect(
      await fetchInnertubePlayerTrack("abc", {
        fetchImpl: fetchWith({
          lengthSeconds: "215",
          title: "X",
          videoId: "zzz",
        }),
      }),
    ).toBe(undefined);
    expect(
      await fetchInnertubePlayerTrack("abc", {
        fetchImpl: fetchWith({ title: "X", videoId: "abc" }),
      }),
    ).toBe(undefined);
  });

  it("returns undefined when the video is not playable", async () => {
    const fetchImpl = (() =>
      jsonResponse(200, {
        playabilityStatus: { status: "LOGIN_REQUIRED" },
        videoDetails: { lengthSeconds: "215", title: "X", videoId: "abc" },
      })) as unknown as typeof fetch;
    expect(await fetchInnertubePlayerTrack("abc", { fetchImpl })).toBe(
      undefined,
    );
  });
});
