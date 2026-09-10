import { describe, expect, it, vi } from "vitest";

import { fetchAutoplayVideoId } from "../src/media/youtube/innertube-related.js";

function nextResponse(sets: unknown): Response {
  return new Response(
    JSON.stringify({
      contents: {
        twoColumnWatchNextResults: { autoplay: { autoplay: { sets } } },
      },
    }),
  );
}

const autoplaySet = (videoId: string): unknown => ({
  autoplayVideo: { watchEndpoint: { videoId } },
});

describe("fetchAutoplayVideoId", () => {
  it("returns the autoplay pick", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(nextResponse([autoplaySet("1E30uKYHiEk")])),
    );

    await expect(
      fetchAutoplayVideoId("dQw4w9WgXcQ", { fetchImpl: fetch }),
    ).resolves.toBe("1E30uKYHiEk");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("skips malformed sets and returns undefined when empty", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        nextResponse([{ autoplayVideo: {} }, { nope: true }, "junk"]),
      ),
    );

    await expect(
      fetchAutoplayVideoId("dQw4w9WgXcQ", { fetchImpl: fetch }),
    ).resolves.toBeUndefined();
  });

  it("returns undefined on failure without throwing", async () => {
    const failing = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(new Response("{}", { status: 500 })),
    );
    await expect(
      fetchAutoplayVideoId("dQw4w9WgXcQ", { fetchImpl: failing }),
    ).resolves.toBeUndefined();

    const down = vi.fn<typeof globalThis.fetch>(() =>
      Promise.reject(new Error("down")),
    );
    await expect(
      fetchAutoplayVideoId("dQw4w9WgXcQ", { fetchImpl: down }),
    ).resolves.toBeUndefined();
  });
});
