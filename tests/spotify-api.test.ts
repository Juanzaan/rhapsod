import { describe, expect, it, vi } from "vitest";

import { SpotifyApi } from "../src/media/spotify/api.js";

function request(input: string | URL | Request): string {
  return typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

describe("SpotifyApi", () => {
  it("requests a client credentials token and resolves track metadata", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((input, init) => {
      if (request(input) === "https://accounts.spotify.com/api/token") {
        expect(init?.method).toBe("POST");
        expect(init?.headers).toMatchObject({
          Authorization: `Basic ${Buffer.from("id:secret").toString("base64")}`,
        });
        return Promise.resolve(
          jsonResponse({ access_token: "token-1", expires_in: 3600 }),
        );
      }
      if (request(input) === "https://api.spotify.com/v1/tracks/abc123") {
        expect(init?.headers).toMatchObject({
          Authorization: "Bearer token-1",
        });
        return Promise.resolve(
          jsonResponse({
            artists: [{ name: "Duki" }],
            duration_ms: 180_000,
            id: "abc123",
            name: "Rockstar",
          }),
        );
      }
      throw new Error(`Unexpected request: ${request(input)}`);
    });
    const api = new SpotifyApi({
      clientId: "id",
      clientSecret: "secret",
      fetch,
    });

    const track = await api.getTrack({ id: "abc123", type: "track" });

    expect(track).toEqual({
      artist: "Duki",
      durationSeconds: 180,
      id: "abc123",
      title: "Rockstar",
    });
  });

  it("reuses the cached token while it is fresh", async () => {
    const tokenCalls = vi.fn();
    const fetch = vi.fn<typeof globalThis.fetch>((input) => {
      if (request(input) === "https://accounts.spotify.com/api/token") {
        tokenCalls();
        return Promise.resolve(
          jsonResponse({ access_token: "token-1", expires_in: 3600 }),
        );
      }
      return Promise.resolve(
        jsonResponse({ artists: [], duration_ms: 1, id: "x", name: "X" }),
      );
    });
    const api = new SpotifyApi({
      clientId: "id",
      clientSecret: "secret",
      fetch,
    });

    await api.getTrack({ id: "a", type: "track" });
    await api.getTrack({ id: "b", type: "track" });

    expect(tokenCalls).toHaveBeenCalledTimes(1);
  });

  it("refreshes the token once when the API answers 401", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((input) => {
      if (request(input) === "https://accounts.spotify.com/api/token") {
        return Promise.resolve(
          jsonResponse({ access_token: "token-1", expires_in: 3600 }),
        );
      }
      if (request(input) === "https://api.spotify.com/v1/tracks/abc123") {
        return Promise.resolve(jsonResponse({}, 401));
      }
      throw new Error(`Unexpected request: ${request(input)}`);
    });
    const api = new SpotifyApi({
      clientId: "id",
      clientSecret: "secret",
      fetch,
    });

    await expect(api.getTrack({ id: "abc123", type: "track" })).rejects.toThrow(
      "Spotify API returned 401",
    );
    expect(fetch.mock.calls.length).toBe(4);
  });

  it("uses the refresh-token flow and the /items endpoint for playlists", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((input, init) => {
      const url = request(input);
      if (url === "https://accounts.spotify.com/api/token") {
        expect(init?.body).toBeInstanceOf(URLSearchParams);
        expect((init?.body as URLSearchParams).toString()).toBe(
          "grant_type=refresh_token&refresh_token=refresh-1",
        );
        expect(init?.headers).toMatchObject({
          Authorization: `Basic ${Buffer.from("id:secret").toString("base64")}`,
        });
        return Promise.resolve(
          jsonResponse({ access_token: "token-user", expires_in: 3600 }),
        );
      }
      if (url.startsWith("https://api.spotify.com/v1/playlists/p1/items")) {
        expect(init?.headers).toMatchObject({
          Authorization: "Bearer token-user",
        });
        return Promise.resolve(
          jsonResponse({
            items: [
              {
                track: {
                  id: "t1",
                  name: "Rockstar",
                  artists: [{ name: "Duki" }],
                  duration_ms: 180_000,
                },
              },
            ],
            next: null,
            total: 1,
          }),
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const api = new SpotifyApi({
      clientId: "id",
      clientSecret: "secret",
      refreshToken: "refresh-1",
      fetch,
    });

    const expansion = await api.expandPlaylist(
      { id: "p1", type: "playlist" },
      1,
    );

    expect(expansion.tracks).toEqual([
      { artist: "Duki", durationSeconds: 180, id: "t1", title: "Rockstar" },
    ]);
    expect(expansion.total).toBe(1);
  });

  it("fails with a migration hint when playlists return 403 without a refresh token", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((input) => {
      if (request(input) === "https://accounts.spotify.com/api/token") {
        return Promise.resolve(
          jsonResponse({ access_token: "token-1", expires_in: 3600 }),
        );
      }
      return Promise.resolve(jsonResponse({}, 403));
    });
    const api = new SpotifyApi({
      clientId: "id",
      clientSecret: "secret",
      fetch,
    });

    await expect(
      api.expandPlaylist({ id: "p1", type: "playlist" }, 1),
    ).rejects.toThrow("RHAPSOD_SPOTIFY_REFRESH_TOKEN");
  });

  it("fails with a clear error for HTTP failures", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((input) => {
      if (request(input) === "https://accounts.spotify.com/api/token") {
        return Promise.resolve(jsonResponse({}, 400));
      }
      throw new Error(`Unexpected request: ${request(input)}`);
    });
    const api = new SpotifyApi({
      clientId: "id",
      clientSecret: "secret",
      fetch,
    });

    await expect(api.getTrack({ id: "abc123", type: "track" })).rejects.toThrow(
      "Spotify token request failed with 400",
    );
  });

  it("matches Spotify links and exposes the provider name", () => {
    const api = new SpotifyApi({ clientId: "id", clientSecret: "secret" });

    expect(api.name).toBe("spotify");
    expect(api.match("https://open.spotify.com/track/abc123")).toBe(true);
    expect(api.match("https://open.spotify.com/album/abc123")).toBe(true);
    expect(api.match("https://youtu.be/abc123")).toBe(false);
    expect(api.match("duki rockstar")).toBe(false);
  });

  it("expands a Spotify playlist with pagination and deduplication", async () => {
    const pageCalls = vi.fn();
    const fetch = vi.fn<typeof globalThis.fetch>((input, init) => {
      if (request(input) === "https://accounts.spotify.com/api/token") {
        return Promise.resolve(
          jsonResponse({ access_token: "token-1", expires_in: 3600 }),
        );
      }
      const url = request(input);
      if (url.startsWith("https://api.spotify.com/v1/playlists/p1/tracks")) {
        pageCalls(url);
        const offset = new URL(url).searchParams.get("offset");
        if (offset === "0") {
          return Promise.resolve(
            jsonResponse({
              items: [
                {
                  track: {
                    id: "t1",
                    name: "Rockstar",
                    artists: [{ name: "Duki" }],
                    duration_ms: 180_000,
                  },
                },
                {
                  track: {
                    id: "t2",
                    name: "Ghost Town",
                    artists: [{ name: "Kanye West" }, { name: "Kid Cudi" }],
                    duration_ms: 271_000,
                  },
                },
                null,
              ],
              next: "https://api.spotify.com/v1/playlists/p1/tracks?offset=3",
              total: 4,
            }),
          );
        }
        expect(init?.headers).toMatchObject({
          Authorization: "Bearer token-1",
        });
        return Promise.resolve(
          jsonResponse({
            items: [
              {
                track: {
                  id: "t1",
                  name: "Rockstar",
                  artists: [{ name: "Duki" }],
                  duration_ms: 180_000,
                },
              },
              {
                track: {
                  id: "t3",
                  name: "Nadie",
                  artists: [{ name: "Bizarrap" }],
                  duration_ms: 210_000,
                },
              },
            ],
            next: null,
            total: 4,
          }),
        );
      }
      throw new Error(`Unexpected request: ${request(input)}`);
    });
    const api = new SpotifyApi({
      clientId: "id",
      clientSecret: "secret",
      fetch,
    });

    const expansion = await api.expandPlaylist(
      { id: "p1", type: "playlist" },
      3,
    );

    expect(expansion.tracks).toEqual([
      { artist: "Duki", durationSeconds: 180, id: "t1", title: "Rockstar" },
      {
        artist: "Kanye West",
        durationSeconds: 271,
        id: "t2",
        title: "Ghost Town",
      },
      {
        artist: "Bizarrap",
        durationSeconds: 210,
        id: "t3",
        title: "Nadie",
      },
    ]);
    expect(expansion.total).toBe(4);
    expect(pageCalls).toHaveBeenCalledTimes(2);
    expect(pageCalls.mock.calls[1]?.[0]).toContain("offset=3");
  });

  it("respects the limit and reports the total for Spotify albums", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((input) => {
      if (request(input) === "https://accounts.spotify.com/api/token") {
        return Promise.resolve(
          jsonResponse({ access_token: "token-1", expires_in: 3600 }),
        );
      }
      if (
        request(input).startsWith("https://api.spotify.com/v1/albums/a1/tracks")
      ) {
        return Promise.resolve(
          jsonResponse({
            items: [
              {
                id: "t1",
                name: "Uno",
                artists: [{ name: "Artista" }],
                duration_ms: 100_000,
              },
              {
                id: "t2",
                name: "Dos",
                artists: [{ name: "Artista" }],
                duration_ms: 200_000,
              },
            ],
            next: null,
            total: 2,
          }),
        );
      }
      throw new Error(`Unexpected request: ${request(input)}`);
    });
    const api = new SpotifyApi({
      clientId: "id",
      clientSecret: "secret",
      fetch,
    });

    const expansion = await api.expandAlbum({ id: "a1", type: "album" }, 1);

    expect(expansion.tracks).toHaveLength(1);
    expect(expansion.tracks[0]?.title).toBe("Uno");
    expect(expansion.total).toBe(2);
  });

  it("backs off and retries on rate limiting", async () => {
    let pageAttempts = 0;
    const fetch = vi.fn<typeof globalThis.fetch>((input) => {
      if (request(input) === "https://accounts.spotify.com/api/token") {
        return Promise.resolve(
          jsonResponse({ access_token: "token-1", expires_in: 3600 }),
        );
      }
      if (
        request(input).startsWith(
          "https://api.spotify.com/v1/playlists/p1/tracks",
        )
      ) {
        pageAttempts++;
        if (pageAttempts === 1) {
          return Promise.resolve(
            new Response(null, {
              headers: { "Retry-After": "0" },
              status: 429,
            }),
          );
        }
        return Promise.resolve(
          jsonResponse({ items: [], next: null, total: 0 }),
        );
      }
      throw new Error(`Unexpected request: ${request(input)}`);
    });
    const api = new SpotifyApi({
      clientId: "id",
      clientSecret: "secret",
      fetch,
    });

    const expansion = await api.expandPlaylist(
      { id: "p1", type: "playlist" },
      1,
    );

    expect(expansion.tracks).toEqual([]);
    expect(pageAttempts).toBe(2);
  });
});
