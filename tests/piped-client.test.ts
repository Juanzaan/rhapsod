import { describe, expect, it, vi } from "vitest";

import { PipedClient } from "../src/media/youtube/piped-client.js";

function fakeFetch(
  responses: Array<{ ok: boolean; json: unknown; status?: number }>,
) {
  let callCount = 0;
  return vi.fn(() => {
    const response = responses[callCount++] ?? responses[responses.length - 1]!;
    if (!response.ok) {
      return Promise.resolve({
        ok: false,
        status: response.status ?? 500,
        json: () => Promise.resolve({}),
      } as Response);
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(response.json),
    } as Response);
  });
}

describe("PipedClient", () => {
  it("search returns results from Piped API", async () => {
    const fetchImpl = fakeFetch([
      {
        ok: true,
        json: [
          { url: "/watch?v=abc123", title: "Test Video", duration: 180 },
          { url: "/watch?v=def456", title: "Another Video", duration: 240 },
        ],
      },
    ]);
    const client = new PipedClient(["https://pipedapi.kavin.rocks"], {
      fetch: fetchImpl,
    });

    const results = await client.search("test query");
    expect(results).toHaveLength(2);
    expect(results[0]!.title).toBe("Test Video");
    expect(results[0]!.duration).toBe(180);
  });

  it("search limits results", async () => {
    const fetchImpl = fakeFetch([
      {
        ok: true,
        json: Array.from({ length: 20 }, (_, i) => ({
          url: `/watch?v=id${i}`,
          title: `Video ${i}`,
          duration: 100,
        })),
      },
    ]);
    const client = new PipedClient(["https://pipedapi.kavin.rocks"], {
      fetch: fetchImpl,
    });

    const results = await client.search("query", 5);
    expect(results).toHaveLength(5);
  });

  it("getStreamUrl returns audio URL", async () => {
    const fetchImpl = fakeFetch([
      {
        ok: true,
        json: {
          title: "Test Video",
          duration: 180,
          videoStreams: [
            {
              url: "https://example.com/audio.opus",
              codec: "opus",
              bitrate: 128000,
              format: "AUDIO_OPUS",
            },
            {
              url: "https://example.com/video.mp4",
              codec: "avc1",
              bitrate: 2000000,
              format: "VIDEO_H264",
            },
          ],
        },
      },
    ]);
    const client = new PipedClient(["https://pipedapi.kavin.rocks"], {
      fetch: fetchImpl,
    });

    const url = await client.getStreamUrl("abc123");
    expect(url).toBe("https://example.com/audio.opus");
  });

  it("getStreamUrl falls back to next instance on failure", async () => {
    const fetchImpl = fakeFetch([
      { ok: false, status: 500, json: {} },
      {
        ok: true,
        json: {
          title: "Test Video",
          duration: 180,
          videoStreams: [
            {
              url: "https://example.com/audio.opus",
              codec: "opus",
              bitrate: 128000,
              format: "AUDIO_OPUS",
            },
          ],
        },
      },
    ]);
    const client = new PipedClient(
      ["https://pipedapi.kavin.rocks", "https://pipedapi.in.projectsegfau.lt"],
      {
        fetch: fetchImpl,
      },
    );

    const url = await client.getStreamUrl("abc123");
    expect(url).toBe("https://example.com/audio.opus");
  });

  it("getStreamUrl throws when all instances fail", async () => {
    const fetchImpl = fakeFetch([
      { ok: false, status: 500, json: {} },
      { ok: false, status: 503, json: {} },
    ]);
    const client = new PipedClient(
      ["https://pipedapi.kavin.rocks", "https://pipedapi.in.projectsegfau.lt"],
      {
        fetch: fetchImpl,
      },
    );

    await expect(client.getStreamUrl("abc123")).rejects.toThrow(
      "All Piped instances failed",
    );
  });

  it("getVideoTitle returns title", async () => {
    const fetchImpl = fakeFetch([
      {
        ok: true,
        json: {
          title: "My Video Title",
          duration: 180,
          videoStreams: [],
        },
      },
    ]);
    const client = new PipedClient(["https://pipedapi.kavin.rocks"], {
      fetch: fetchImpl,
    });

    const title = await client.getVideoTitle("abc123");
    expect(title).toBe("My Video Title");
  });

  it("picks best audio stream by bitrate", async () => {
    const fetchImpl = fakeFetch([
      {
        ok: true,
        json: {
          title: "Test",
          duration: 180,
          videoStreams: [
            {
              url: "https://example.com/low.opus",
              codec: "opus",
              bitrate: 64000,
              format: "AUDIO_OPUS",
            },
            {
              url: "https://example.com/high.opus",
              codec: "opus",
              bitrate: 192000,
              format: "AUDIO_OPUS",
            },
            {
              url: "https://example.com/mid.ogg",
              codec: "vorbis",
              bitrate: 128000,
              format: "AUDIO_VORBIS",
            },
          ],
        },
      },
    ]);
    const client = new PipedClient(["https://pipedapi.kavin.rocks"], {
      fetch: fetchImpl,
    });

    const url = await client.getStreamUrl("abc123");
    expect(url).toBe("https://example.com/high.opus");
  });

  it("getStreamUrl throws when no audio stream found", async () => {
    const fetchImpl = fakeFetch([
      {
        ok: true,
        json: {
          title: "Test",
          duration: 180,
          videoStreams: [
            {
              url: "https://example.com/video.mp4",
              codec: "avc1",
              bitrate: 2000000,
              format: "VIDEO_H264",
            },
          ],
        },
      },
    ]);
    const client = new PipedClient(["https://pipedapi.kavin.rocks"], {
      fetch: fetchImpl,
    });

    await expect(client.getStreamUrl("abc123")).rejects.toThrow(
      "no audio stream found",
    );
  });
});
