import { describe, expect, it, vi } from "vitest";

import { SongLinkClient } from "../src/media/song-link.js";

describe("SongLinkClient", () => {
  it("selects a secure YouTube alternative", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            linksByPlatform: {
              soundcloud: { url: "https://soundcloud.com/artist/track" },
              youtube: { url: "https://youtu.be/abc123" },
            },
          }),
        ),
      ),
    );
    const client = new SongLinkClient({ fetch });

    await expect(
      client.findAlternative("https://soundcloud.com/artist/track"),
    ).resolves.toEqual({ provider: "youtube", url: "https://youtu.be/abc123" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("falls back to a SoundCloud alternative when YouTube is missing", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            linksByPlatform: {
              soundcloud: {
                url: "https://soundcloud.com/artist/track",
              },
            },
          }),
        ),
      ),
    );

    await expect(
      new SongLinkClient({ fetch }).findAlternative(
        "https://music.apple.com/us/album/titulo/123?i=456",
      ),
    ).resolves.toEqual({
      provider: "soundcloud",
      url: "https://soundcloud.com/artist/track",
    });
  });

  it("ignores unavailable or unsafe alternatives", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            linksByPlatform: { youtube: { url: "http://example.test/audio" } },
          }),
        ),
      ),
    );
    await expect(
      new SongLinkClient({ fetch }).findAlternative(
        "https://soundcloud.com/artist/track",
      ),
    ).resolves.toBeUndefined();
  });

  it("treats provider timeouts as an unavailable alternative", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.reject(new DOMException("timed out", "TimeoutError")),
    );

    await expect(
      new SongLinkClient({ fetch }).findAlternative(
        "https://soundcloud.com/artist/track",
      ),
    ).resolves.toBeUndefined();
  });
});
