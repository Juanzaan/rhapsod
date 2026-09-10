import { describe, expect, it, vi } from "vitest";

import {
  resolveTuneInStream,
  searchTuneInStations,
} from "../src/media/tunein.js";

const searchBody = {
  body: [
    {
      bitrate: 256,
      formats: "mp3",
      guide_id: "s270143",
      reliability: 100,
      text: "JFK Radio",
      type: "audio",
      URL: "http://opml.radiotime.com/Tune.ashx?id=s270143",
    },
    {
      guide_id: "m107279",
      text: "Artist: JFK",
      type: "link",
      URL: "http://opml.radiotime.com/Browse.ashx?id=m107279",
    },
    {
      guide_id: "p2506815",
      text: "Solving JFK",
      type: "audio",
      URL: "http://opml.radiotime.com/Tune.ashx?c=pbrowse&id=p2506815",
    },
    { text: "No guide", type: "audio" },
    "junk",
  ],
  head: { status: "200" },
};

describe("searchTuneInStations", () => {
  it("returns audio stations with tune ids", async () => {
    let sentUrl = "";
    const fetch = vi.fn<typeof globalThis.fetch>((input) => {
      sentUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      return Promise.resolve(new Response(JSON.stringify(searchBody)));
    });

    const stations = await searchTuneInStations("jfk", { fetch });

    expect(sentUrl).toContain("opml.radiotime.com/search.ashx");
    expect(sentUrl).toContain("query=jfk");
    expect(stations).toEqual([
      { bitrate: 256, id: "s270143", name: "JFK Radio" },
    ]);
  });

  it("returns [] on failure without throwing", async () => {
    const failing = vi.fn<typeof globalThis.fetch>(() =>
      Promise.reject(new Error("down")),
    );
    await expect(
      searchTuneInStations("jfk", { fetch: failing }),
    ).resolves.toEqual([]);

    const broken = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(new Response("not json")),
    );
    await expect(
      searchTuneInStations("jfk", { fetch: broken }),
    ).resolves.toEqual([]);

    const hanging = vi.fn<typeof globalThis.fetch>(
      () => new Promise<Response>(() => {}),
    );
    await expect(
      searchTuneInStations("jfk", { fetch: hanging, timeoutMs: 20 }),
    ).resolves.toEqual([]);
  });
});

describe("resolveTuneInStream", () => {
  it("returns the first https stream from the tune file", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      expect(url).toContain("tune.ashx?id=s270143");
      return Promise.resolve(
        new Response(
          "https://stream.aiir.com/7dsjltmny8cvv\nhttps://streams.example/jfk\nhttp://5.75.180.227/jfk",
        ),
      );
    });

    await expect(resolveTuneInStream("s270143", { fetch })).resolves.toBe(
      "https://stream.aiir.com/7dsjltmny8cvv",
    );
  });

  it("skips comment lines and returns undefined without https", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        new Response("#EXTM3U\n#EXTINF:-1,JFK\nhttp://5.75.180.227/jfk\n"),
      ),
    );

    await expect(
      resolveTuneInStream("s270143", { fetch }),
    ).resolves.toBeUndefined();
  });

  it("returns undefined on failure without throwing", async () => {
    const failing = vi.fn<typeof globalThis.fetch>(() =>
      Promise.reject(new Error("down")),
    );
    await expect(
      resolveTuneInStream("s1", { fetch: failing }),
    ).resolves.toBeUndefined();
  });
});
