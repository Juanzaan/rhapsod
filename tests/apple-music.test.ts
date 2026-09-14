import { describe, expect, it, vi } from "vitest";

import {
  AppleMusicClient,
  parseAppleMusicId,
} from "../src/media/apple-music.js";

const songLookup = {
  resultCount: 1,
  results: [
    {
      artistName: "Rick Astley",
      kind: "song",
      trackName: "Never Gonna Give You Up",
      trackTimeMillis: 214720,
      wrapperType: "track",
    },
  ],
};

const albumLookup = {
  resultCount: 1,
  results: [
    {
      artistName: "Duki",
      collectionName: "Temporada de Reggaetón",
      collectionType: "Album",
      wrapperType: "collection",
    },
  ],
};

function lookupFetch(body: unknown, status = 200) {
  return vi.fn<typeof globalThis.fetch>(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status })),
  );
}

describe("parseAppleMusicId", () => {
  it("reads track and album ids from Apple Music URLs", () => {
    expect(
      parseAppleMusicId(
        "https://music.apple.com/us/album/never-gonna-give-you-up/1559523357?i=1559523359",
      ),
    ).toBe("1559523359");
    expect(
      parseAppleMusicId("https://music.apple.com/us/song/titulo/987654321"),
    ).toBe("987654321");
    expect(
      parseAppleMusicId("https://music.apple.com/ar/album/titulo/123456789"),
    ).toBe("123456789");
    expect(
      parseAppleMusicId("https://itunes.apple.com/ar/album/titulo/123456789"),
    ).toBe("123456789");
  });

  it("rejects playlists and non-Apple links", () => {
    for (const input of [
      "duki rockstar",
      "",
      "https://music.apple.com/us/playlist/pl.u-123",
      "https://music.apple.com/us/album/sin-id",
      "https://open.spotify.com/track/abc123",
    ]) {
      expect(parseAppleMusicId(input)).toBeUndefined();
    }
  });
});

describe("AppleMusicClient", () => {
  it("returns artist, title and duration for songs", async () => {
    let sentUrl = "";
    const fetch = vi.fn<typeof globalThis.fetch>((input) => {
      sentUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      return lookupFetch(songLookup)(input);
    });
    const client = new AppleMusicClient({ fetch });

    await expect(
      client.getTrack("https://music.apple.com/us/album/x/1?i=1559523359"),
    ).resolves.toEqual({
      artist: "Rick Astley",
      durationSeconds: 215,
      title: "Never Gonna Give You Up",
    });
    expect(sentUrl).toContain("itunes.apple.com/lookup?id=1559523359");
  });

  it("falls back to the album name for collections", async () => {
    const client = new AppleMusicClient({ fetch: lookupFetch(albumLookup) });

    await expect(
      client.getTrack("https://music.apple.com/ar/album/titulo/123456789"),
    ).resolves.toEqual({
      artist: "Duki",
      title: "Temporada de Reggaetón",
    });
  });

  it("reports unknown links without throwing unexpected errors", async () => {
    const client = new AppleMusicClient({
      fetch: lookupFetch({ resultCount: 0, results: [] }),
    });
    await expect(
      client.getTrack("https://music.apple.com/us/song/x/999"),
    ).rejects.toThrow("No encontré esa canción en Apple Music.");

    const broken = new AppleMusicClient({
      fetch: vi.fn<typeof globalThis.fetch>(() =>
        Promise.reject(new Error("down")),
      ),
    });
    await expect(
      broken.getTrack("https://music.apple.com/us/song/x/999"),
    ).rejects.toThrow("No pude contactar a Apple Music.");

    const missing = new AppleMusicClient({ fetch: lookupFetch(songLookup) });
    await expect(missing.getTrack("not a link")).rejects.toThrow(
      "No reconozco ese link de Apple Music.",
    );
  });
});
