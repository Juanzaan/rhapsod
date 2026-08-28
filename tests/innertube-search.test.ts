import { describe, expect, it } from "vitest";

import { searchInnertubeVideos } from "../src/media/youtube/innertube-search.js";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    json: () => body,
  } as unknown as Response;
}

function searchBody(results: unknown[]): unknown {
  return {
    contents: {
      twoColumnSearchResultsRenderer: {
        primaryContents: {
          sectionListRenderer: {
            contents: [
              {
                itemSectionRenderer: {
                  contents: results,
                },
              },
            ],
          },
        },
      },
    },
  };
}

function videoRenderer(
  id: string,
  title: string,
  duration = "3:31",
  channel = "Test Channel",
): unknown {
  return {
    videoRenderer: {
      lengthText: { runs: [{ text: duration }] },
      ownerText: { runs: [{ text: channel }] },
      title: { runs: [{ text: title }] },
      videoId: id,
    },
  };
}

describe("searchInnertubeVideos", () => {
  it("parses video results with duration and channel", async () => {
    const fetchImpl = (() =>
      jsonResponse(
        200,
        searchBody([videoRenderer("abc123", "Artist - Song", "4:05", "Chan")]),
      )) as unknown as typeof fetch;
    const results = await searchInnertubeVideos("artist song", { fetchImpl });
    expect(results).toEqual([
      {
        channel: "Chan",
        durationSeconds: 245,
        id: "abc123",
        title: "Artist - Song",
      },
    ]);
  });

  it("parses hours-long durations", async () => {
    const fetchImpl = (() =>
      jsonResponse(
        200,
        searchBody([videoRenderer("x", "Live Set", "1:02:30")]),
      )) as unknown as typeof fetch;
    const results = await searchInnertubeVideos("live set", { fetchImpl });
    expect(results[0]?.durationSeconds).toBe(3750);
  });

  it("skips results without an id or title and caps the list", async () => {
    const fetchImpl = (() =>
      jsonResponse(
        200,
        searchBody([
          videoRenderer("a", "One"),
          { videoRenderer: { videoId: "b" } },
          { channelRenderer: { channelId: "c" } },
          videoRenderer("d", "Four"),
        ]),
      )) as unknown as typeof fetch;
    const results = await searchInnertubeVideos("q", {
      fetchImpl,
      maxResults: 1,
    });
    expect(results).toEqual([
      expect.objectContaining({ id: "a", title: "One" }),
    ]);
  });

  it("returns empty on HTTP errors", async () => {
    const fetchImpl = (() => jsonResponse(429, {})) as unknown as typeof fetch;
    expect(await searchInnertubeVideos("q", { fetchImpl })).toEqual([]);
  });

  it("returns empty on malformed responses", async () => {
    const fetchImpl = (() =>
      jsonResponse(200, { nope: true })) as unknown as typeof fetch;
    expect(await searchInnertubeVideos("q", { fetchImpl })).toEqual([]);
  });

  it("returns empty when the fetch throws", async () => {
    const fetchImpl = (() => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    expect(await searchInnertubeVideos("q", { fetchImpl })).toEqual([]);
  });
});
