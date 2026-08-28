import { describe, expect, it, vi } from "vitest";

import { fetchInnertubePlayerAudioUrl } from "../src/media/youtube/innertube-player.js";

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
    expect(await fetchInnertubePlayerAudioUrl("abc", { fetchImpl })).toBe(
      "https://googlevideo.example/251",
    );
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
    expect(await fetchInnertubePlayerAudioUrl("abc", { fetchImpl })).toBe(
      "https://googlevideo.example/141",
    );
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
