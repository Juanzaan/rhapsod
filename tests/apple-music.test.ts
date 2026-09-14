import { describe, expect, it, vi } from "vitest";

import {
  AppleMusicClient,
  isAppleMusicPlaylist,
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
      id: "1559523359",
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
      id: "123456789",
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

describe("isAppleMusicPlaylist", () => {
  it("detects playlist links", () => {
    expect(
      isAppleMusicPlaylist("https://music.apple.com/pe/playlist/pl.u-123"),
    ).toBe(true);
    expect(
      isAppleMusicPlaylist("https://music.apple.com/us/album/titulo/123?i=456"),
    ).toBe(false);
    expect(isAppleMusicPlaylist("duki rockstar")).toBe(false);
  });
});

describe("AppleMusicClient.getPlaylist", () => {
  const playlistPage = `<html><head><title>\u200e\u201cParty\u201d de Dj en Apple Music</title></head><body>
<a href="https://music.apple.com/us/song/one/111">One</a>
<a href="https://music.apple.com/us/song/two/222">Two</a>
<a href="https://music.apple.com/us/song/one/111">One again</a>
</body></html>`;
  const playlistLookup = {
    resultCount: 2,
    results: [
      {
        artistName: "Artist B",
        kind: "song",
        trackId: 222,
        trackName: "Two",
        wrapperType: "track",
      },
      {
        artistName: "Artist A",
        kind: "song",
        trackId: 111,
        trackName: "One",
        trackTimeMillis: 180000,
        trackViewUrl: "https://music.apple.com/us/song/one/111",
        wrapperType: "track",
      },
    ],
  };

  function playlistFetch() {
    return vi.fn<typeof globalThis.fetch>((input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.includes("itunes.apple.com/lookup")) {
        if (!url.includes("id=111,222")) {
          return Promise.resolve(new Response("{}", { status: 400 }));
        }
        return Promise.resolve(new Response(JSON.stringify(playlistLookup)));
      }
      return Promise.resolve(new Response(playlistPage));
    });
  }

  it("expands playlist tracks in page order with one batched lookup", async () => {
    const fetch = playlistFetch();
    const client = new AppleMusicClient({ fetch });

    const playlist = await client.getPlaylist(
      "https://music.apple.com/pe/playlist/pl.u-123",
    );

    expect(playlist.name).toBe("Party");
    expect(playlist.tracks).toEqual([
      {
        artist: "Artist A",
        durationSeconds: 180,
        id: "111",
        title: "One",
        url: "https://music.apple.com/us/song/one/111",
      },
      { artist: "Artist B", id: "222", title: "Two" },
    ]);
    expect(
      fetch.mock.calls.filter((call) => {
        const input = call[0];
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        return url.includes("itunes.apple.com/lookup");
      }),
    ).toHaveLength(1);
  });

  it("skips tracks missing from the lookup", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.includes("itunes.apple.com/lookup")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              resultCount: 1,
              results: [playlistLookup.results[1]],
            }),
          ),
        );
      }
      return Promise.resolve(new Response(playlistPage));
    });
    const client = new AppleMusicClient({ fetch });

    const playlist = await client.getPlaylist(
      "https://music.apple.com/pe/playlist/pl.u-123",
    );

    expect(playlist.tracks.map((track) => track.id)).toEqual(["111"]);
  });

  it("rejects pages without songs", async () => {
    const empty = new AppleMusicClient({
      fetch: vi.fn<typeof globalThis.fetch>(() =>
        Promise.resolve(new Response("<html></html>")),
      ),
    });
    await expect(
      empty.getPlaylist("https://music.apple.com/pe/playlist/pl.u-123"),
    ).rejects.toThrow("No encontré canciones en esa playlist.");

    const single = new AppleMusicClient({
      fetch: lookupFetch(songLookup),
    });
    await expect(
      single.getPlaylist("https://music.apple.com/us/album/x/1?i=2"),
    ).rejects.toThrow("No reconozco esa playlist de Apple Music.");
  });
});
