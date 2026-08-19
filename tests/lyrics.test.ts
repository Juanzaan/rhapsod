import { describe, expect, it, vi } from "vitest";

import { LyricsClient, parseArtistTitle } from "../src/media/lyrics.js";

describe("LyricsClient", () => {
  it("searches LRCLIB by artist and track and returns plain lyrics", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify([
            {
              artistName: "Duki",
              plainLyrics: "Rockstar, rockstar",
              trackName: "Rockstar",
            },
            {
              artistName: "Otro",
              plainLyrics: "Otra letra",
              trackName: "Rockstar (Remix)",
            },
          ]),
        ),
      ),
    );
    const client = new LyricsClient({ fetch });

    const lyrics = await client.search("Duki", "Rockstar");

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(lyrics).toEqual({
      artist: "Duki",
      plainLyrics: "Rockstar, rockstar",
      title: "Rockstar",
    });
  });

  it("skips instrumental hits without lyrics", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify([
            {
              artistName: "Duki",
              instrumental: true,
              plainLyrics: "Rockstar, rockstar",
              trackName: "Rockstar",
            },
            {
              artistName: "Duki",
              plainLyrics: "Letra completa",
              trackName: "Rockstar",
            },
          ]),
        ),
      ),
    );
    const client = new LyricsClient({ fetch });

    const lyrics = await client.search("Duki", "Rockstar");

    expect(lyrics?.plainLyrics).toBe("Letra completa");
  });

  it("returns undefined when the response has no lyrics", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(new Response(JSON.stringify([]))),
    );
    const client = new LyricsClient({ fetch });

    expect(await client.search("Duki", "Rockstar")).toBeUndefined();
  });

  it("returns undefined on non-OK responses", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(new Response(null, { status: 429 })),
    );
    const client = new LyricsClient({ fetch });

    expect(await client.search("Duki", "Rockstar")).toBeUndefined();
  });

  it("returns undefined on network failures", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.reject(new Error("fetch failed")),
    );
    const client = new LyricsClient({ fetch });

    expect(await client.search("Duki", "Rockstar")).toBeUndefined();
  });
});

describe("parseArtistTitle", () => {
  it("splits artist and title on the first separator", () => {
    expect(parseArtistTitle("Duki - Rockstar (Official Video)")).toEqual({
      artist: "Duki",
      title: "Rockstar",
    });
  });

  it("strips bracketed annotations", () => {
    expect(parseArtistTitle("[HD] Duki - Rockstar (Official Video)")).toEqual({
      artist: "Duki",
      title: "Rockstar",
    });
  });

  it("keeps the whole input when there is no separator", () => {
    expect(parseArtistTitle("Rockstar")).toEqual({ title: "Rockstar" });
  });

  it("keeps the whole input when the artist side is empty", () => {
    expect(parseArtistTitle(" - Rockstar")).toEqual({ title: "- Rockstar" });
  });
});
