import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { Track } from "../src/domain/track.js";
import {
  musicBoundsFromSegments,
  NonMusicSegments,
  videoIdHashPrefix,
} from "../src/media/youtube/non-music-segments.js";

const VIDEO_ID = "dQw4w9WgXcQ";

function track(overrides: Partial<Track> = {}): Track {
  return {
    durationSeconds: 240,
    id: VIDEO_ID,
    requestedBy: "user",
    source: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    title: "Artist - Song (Official Video)",
    ...overrides,
  };
}

function apiResponse(
  segments: Array<{
    actionType?: string;
    category?: string;
    segment: [number, number];
    videoDuration?: number;
  }>,
  videoId = VIDEO_ID,
): Response {
  return new Response(
    JSON.stringify([
      { hash: "other", segments: [], videoID: "zzzzzzzzzzz" },
      {
        hash: "match",
        segments: segments.map((segment) => ({
          actionType: "skip",
          category: "music_offtopic",
          UUID: "uuid",
          videoDuration: 240,
          ...segment,
        })),
        videoID: videoId,
      },
    ]),
    { status: 200 },
  );
}

describe("musicBoundsFromSegments", () => {
  it("cuts an intro and an outro", () => {
    expect(
      musicBoundsFromSegments(
        [
          [0, 14.5],
          [221, 240],
        ],
        240,
      ),
    ).toEqual({ endSeconds: 221, startSeconds: 14.5 });
  });

  it("leaves segments in the middle alone", () => {
    expect(musicBoundsFromSegments([[60, 90]], 240)).toBeUndefined();
  });

  it("joins overlapping intro submissions", () => {
    expect(
      musicBoundsFromSegments(
        [
          [0.4, 10],
          [0, 16],
        ],
        240,
      ),
    ).toEqual({ startSeconds: 16 });
  });

  it("refuses a trim that leaves less than half the track", () => {
    expect(musicBoundsFromSegments([[0, 150]], 240)).toBeUndefined();
  });

  it("refuses a trim that leaves less than 30 seconds", () => {
    expect(musicBoundsFromSegments([[0, 40]], 60)).toBeUndefined();
  });
});

describe("NonMusicSegments", () => {
  it("asks by a 4-character hash prefix, never by the video id", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(apiResponse([{ segment: [0, 12] }])),
    );
    const segments = new NonMusicSegments({ fetch });

    await expect(segments.boundsFor(track())).resolves.toEqual({
      startSeconds: 12,
    });

    const url = new URL(fetch.mock.calls[0]?.[0] as string);
    const prefix = createHash("sha256")
      .update(VIDEO_ID)
      .digest("hex")
      .slice(0, 4);
    expect(videoIdHashPrefix(VIDEO_ID)).toBe(prefix);
    expect(url.origin).toBe("https://sponsor.ajay.app");
    expect(url.pathname).toBe(`/api/skipSegments/${prefix}`);
    expect(url.searchParams.get("categories")).toBe('["music_offtopic"]');
    expect(url.toString()).not.toContain(VIDEO_ID);
  });

  it("ignores other categories and actions", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        apiResponse([
          { category: "sponsor", segment: [0, 30] },
          { actionType: "mute", segment: [220, 240] },
        ]),
      ),
    );
    const segments = new NonMusicSegments({ fetch });

    await expect(segments.boundsFor(track())).resolves.toBeUndefined();
  });

  it("ignores segments submitted against a different cut of the video", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(apiResponse([{ segment: [0, 12], videoDuration: 300 }])),
    );
    const segments = new NonMusicSegments({ fetch });

    await expect(segments.boundsFor(track())).resolves.toBeUndefined();
  });

  it("skips tracks that are not YouTube videos or have no duration", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const segments = new NonMusicSegments({ fetch });

    await expect(
      segments.boundsFor(
        track({ source: "https://soundcloud.com/artist/song" }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      segments.boundsFor({
        id: VIDEO_ID,
        requestedBy: "user",
        source: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
        title: "Live",
      }),
    ).resolves.toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("caches an answer, including a 404", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(new Response("Not Found", { status: 404 })),
    );
    const segments = new NonMusicSegments({ fetch });

    await segments.boundsFor(track());
    await segments.boundsFor(track());

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("asks again after a failed lookup", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.reject(new Error("offline")),
    );
    const segments = new NonMusicSegments({ fetch });

    await expect(segments.boundsFor(track())).resolves.toBeUndefined();
    await expect(segments.boundsFor(track())).resolves.toBeUndefined();

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("stops waiting for a slow answer and keeps it for the next play", async () => {
    let answer: (response: Response) => void = () => undefined;
    const fetch = vi.fn<typeof globalThis.fetch>(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    const segments = new NonMusicSegments({ fetch, waitMs: 10 });

    await expect(segments.boundsFor(track())).resolves.toBeUndefined();
    answer(apiResponse([{ segment: [0, 12] }]));

    await expect(segments.boundsFor(track())).resolves.toEqual({
      startSeconds: 12,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
