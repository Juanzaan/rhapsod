import { describe, expect, it, vi } from "vitest";

import {
  SoundCloudDrmError,
  SoundCloudPublicApi,
} from "../src/media/soundcloud/public-api.js";

const track = {
  access: "playable",
  id: 42,
  media: {
    transcodings: [
      { format: { protocol: "hls" }, url: "https://api-v2.soundcloud.com/hls" },
      {
        format: { protocol: "progressive" },
        url: "https://api-v2.soundcloud.com/progressive",
      },
    ],
  },
  permalink_url: "https://soundcloud.com/artist/track",
  policy: "ALLOW",
  streamable: true,
  title: "Track",
};

function response(body: unknown, url = ""): Response {
  const result = new Response(
    typeof body === "string" ? body : JSON.stringify(body),
  );
  if (url) Object.defineProperty(result, "url", { value: url });
  return result;
}

function requestUrl(input: string | URL | Request): string {
  return typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
}

describe("SoundCloudPublicApi", () => {
  it("discovers a client id and resolves the progressive stream", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((input) => {
      const url = requestUrl(input);
      if (url === "https://soundcloud.com/")
        return Promise.resolve(
          response(
            '<script src="https://a-v2.sndcdn.com/assets/app.js"></script>',
          ),
        );
      if (url.includes("app.js"))
        return Promise.resolve(
          response('client_id="abcdefghijklmnopqrstuvwx"'),
        );
      if (url.includes("/resolve?")) return Promise.resolve(response(track));
      if (url.includes("/progressive?"))
        return Promise.resolve(
          response({ url: "https://media.example/audio.mp3" }),
        );
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });

    await expect(
      new SoundCloudPublicApi({ fetch }).getTrack(
        "https://soundcloud.com/artist/track",
      ),
    ).resolves.toMatchObject({
      audioUrl: "https://media.example/audio.mp3",
      id: "soundcloud:42",
      title: "Track",
    });
  });

  it("rejects tracks SoundCloud marks as blocked and keeps metadata", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((input) => {
      const url = requestUrl(input);
      if (url === "https://soundcloud.com/")
        return Promise.resolve(
          response(
            '<script src="https://a-v2.sndcdn.com/assets/app.js"></script>',
          ),
        );
      if (url.includes("app.js"))
        return Promise.resolve(
          response('client_id="abcdefghijklmnopqrstuvwx"'),
        );
      return Promise.resolve(response({ ...track, access: "blocked" }));
    });

    const error = await new SoundCloudPublicApi({ fetch })
      .getTrack("https://soundcloud.com/artist/track")
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SoundCloudDrmError);
    if (error instanceof SoundCloudDrmError) {
      expect(error.metadata).toEqual({ artist: "artist", title: "Track" });
    }
  });

  it("derives DRM metadata from publisher artist and duration", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((input) => {
      const url = requestUrl(input);
      if (url === "https://soundcloud.com/")
        return Promise.resolve(
          response(
            '<script src="https://a-v2.sndcdn.com/assets/app.js"></script>',
          ),
        );
      if (url.includes("app.js"))
        return Promise.resolve(
          response('client_id="abcdefghijklmnopqrstuvwx"'),
        );
      return Promise.resolve(
        response({
          ...track,
          access: "blocked",
          duration: 224_000,
          publisher_metadata: { artist: "Kanye West" },
          title: "OK (feat. Don Toliver)",
        }),
      );
    });

    await expect(
      new SoundCloudPublicApi({ fetch }).getTrack(
        "https://soundcloud.com/artist/track",
      ),
    ).rejects.toMatchObject({
      metadata: {
        artist: "Kanye West",
        durationSeconds: 224,
        title: "OK (feat. Don Toliver)",
      },
    });
  });
});
