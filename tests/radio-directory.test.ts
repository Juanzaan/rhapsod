import { describe, expect, it, vi } from "vitest";

import { searchStations } from "../src/media/radio-directory.js";

function stationResponse(body: unknown): Response {
  return new Response(JSON.stringify(body));
}

describe("searchStations", () => {
  it("returns parsed stations top voted first", async () => {
    let sentUrl = "";
    let sentAgent: string | null = null;
    const fetch = vi.fn<typeof globalThis.fetch>((input, init) => {
      sentUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      sentAgent = new Headers(init?.headers).get("User-Agent");
      return Promise.resolve(
        stationResponse([
          {
            bitrate: 128,
            codec: "MP3",
            country: "United States",
            name: "Groove Salad",
            tags: "ambient,beats",
            url: "http://ice1.somafm.com/groovesalad-128-mp3",
            url_resolved: "https://ice1.somafm.com/groovesalad-128-mp3",
            votes: 1200,
          },
          { name: "", url: "https://example.com/broken" },
          "garbage",
        ]),
      );
    });

    const stations = await searchStations("groove", { fetch });

    expect(sentUrl).toContain("de1.api.radio-browser.info");
    expect(sentUrl).toContain("name=groove");
    expect(sentAgent).toContain("Rhapsod");
    expect(stations).toEqual([
      {
        bitrate: 128,
        codec: "MP3",
        country: "United States",
        name: "Groove Salad",
        tags: "ambient,beats",
        url: "https://ice1.somafm.com/groovesalad-128-mp3",
        votes: 1200,
      },
    ]);
  });

  it("returns [] when the directory is unreachable or broken", async () => {
    const failing = vi.fn<typeof globalThis.fetch>(() =>
      Promise.reject(new Error("down")),
    );
    await expect(searchStations("jazz", { fetch: failing })).resolves.toEqual(
      [],
    );

    const broken = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(new Response("not json", { status: 500 })),
    );
    await expect(searchStations("jazz", { fetch: broken })).resolves.toEqual(
      [],
    );

    const hanging = vi.fn<typeof globalThis.fetch>(
      () => new Promise<Response>(() => {}),
    );
    await expect(
      searchStations("jazz", { fetch: hanging, timeoutMs: 20 }),
    ).resolves.toEqual([]);
  });
});
