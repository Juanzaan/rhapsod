import { describe, expect, it, vi } from "vitest";

import {
  parseTuneInStationId,
  resolveTuneInStream,
  resolveTuneInUrl,
  searchTuneInStations,
} from "../src/media/tunein.js";

const lookupMock = vi.hoisted(() => vi.fn());

vi.mock("node:dns/promises", () => ({
  lookup: lookupMock,
}));

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

describe("parseTuneInStationId", () => {
  it("reads station ids from TuneIn URLs", () => {
    expect(
      parseTuneInStationId("https://tunein.com/radio/JFK-Radio-s270143/"),
    ).toBe("s270143");
    expect(parseTuneInStationId("https://www.tunein.com/radio/X-s54700")).toBe(
      "s54700",
    );
    expect(
      parseTuneInStationId("https://opml.radiotime.com/Tune.ashx?id=s270143"),
    ).toBe("s270143");
  });

  it("rejects non-station links", () => {
    for (const input of [
      "jfk ibiza",
      "",
      "https://tunein.com/",
      "https://tunein.com/radio/NoIdHere/",
      "https://opml.radiotime.com/Tune.ashx?id=p2506815",
      "https://opml.radiotime.com/Browse.ashx?id=m107279",
      "https://stream.example/jfk",
    ]) {
      expect(parseTuneInStationId(input)).toBeUndefined();
    }
  });
});

describe("resolveTuneInUrl", () => {
  const linkResponse = (
    options: { body?: string; location?: string; status?: number } = {},
  ) =>
    ({
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "location" ? (options.location ?? null) : null,
      },
      ok: (options.status ?? 200) >= 200 && (options.status ?? 200) < 300,
      status: options.status ?? 200,
      text: () => Promise.resolve(options.body ?? ""),
    }) as unknown as Response;

  function linkFetch() {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    return vi.fn<typeof globalThis.fetch>((input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url === "http://tun.in/sfrnd") {
        return Promise.resolve(
          linkResponse({
            location: "https://tunein.com/radio/JFK-Radio-s270143/",
            status: 301,
          }),
        );
      }
      if (url === "https://opml.radiotime.com/tune.ashx?id=s270143") {
        return Promise.resolve(
          linkResponse({
            body: "https://stream.aiir.com/7dsjltmny8cvv\nhttp://5.75.180.227/jfk\n",
          }),
        );
      }
      return Promise.resolve(linkResponse({ status: 404 }));
    });
  }

  it("follows a tun.in short link to the first https stream", async () => {
    const fetch = linkFetch();

    await expect(
      resolveTuneInUrl("http://tun.in/sfrnd", { fetch }),
    ).resolves.toBe("https://stream.aiir.com/7dsjltmny8cvv");
    const urls = fetch.mock.calls.map((call) => {
      const input = call[0];
      return typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    });
    expect(urls).toContain("http://tun.in/sfrnd");
    expect(urls).toContain("https://opml.radiotime.com/tune.ashx?id=s270143");
  });

  it("resolves tunein.com pages without following links", async () => {
    const fetch = linkFetch();

    await expect(
      resolveTuneInUrl("https://tunein.com/radio/JFK-Radio-s270143/", {
        fetch,
      }),
    ).resolves.toBe("https://stream.aiir.com/7dsjltmny8cvv");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("returns undefined for non-TuneIn targets without throwing", async () => {
    lookupMock.mockReset();
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(linkResponse({ status: 200 })),
    );

    await expect(
      resolveTuneInUrl("http://tun.in/other", { fetch }),
    ).resolves.toBeUndefined();
    await expect(
      resolveTuneInUrl("jfk ibiza", { fetch }),
    ).resolves.toBeUndefined();
    await expect(
      resolveTuneInUrl("http://127.0.0.1/x", { fetch }),
    ).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
