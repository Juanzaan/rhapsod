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
});
