import { describe, expect, it, vi } from "vitest";

import {
  createYtDlpResolverStack,
  SystemYtDlpExecutor,
  YoutubeResolver,
} from "../src/media/youtube/yt-dlp.js";

vi.mock("../src/media/youtube/innertube-player.js", () => ({
  fetchInnertubePlayerAudioUrl: vi.fn(() => Promise.resolve(undefined)),
}));

describe("createYtDlpResolverStack", () => {
  it("builds an executor and resolver pair", () => {
    const { executor, resolver } = createYtDlpResolverStack(undefined, {
      ytdlpPath: "yt-dlp",
    });

    expect(executor).toBeInstanceOf(SystemYtDlpExecutor);
    expect(resolver).toBeInstanceOf(YoutubeResolver);
    expect(resolver.name).toBe("youtube");
  });

  it("routes audio resolution through the daemon when configured", async () => {
    // No local yt-dlp spawn happens on this path: the stub daemon answers
    // first, so the factory wiring (daemon URL + fetch) is what resolves.
    const seenUrls: unknown[] = [];
    const daemonFetch = vi.fn((url: unknown): Promise<Response> => {
      seenUrls.push(url);
      return Promise.resolve(
        Response.json({ url: "https://media.example/daemon" }),
      );
    });
    const { resolver } = createYtDlpResolverStack(undefined, {
      daemonFetch,
      daemonUrl: "http://127.0.0.1:8765",
      ytdlpPath: "yt-dlp",
    });

    await expect(
      resolver.getAudioUrlFromUrl("https://www.youtube.com/watch?v=abc"),
    ).resolves.toBe("https://media.example/daemon");
    expect(daemonFetch).toHaveBeenCalledTimes(1);
    expect(seenUrls[0]).toEqual(expect.stringContaining("/resolve?url="));
  });

  it("skips the daemon when no daemon URL is configured", async () => {
    const seenUrls: unknown[] = [];
    const daemonFetch = vi.fn((url: unknown): Promise<Response> => {
      seenUrls.push(url);
      return Promise.resolve(
        Response.json({ url: "https://media.example/daemon" }),
      );
    });
    const { resolver } = createYtDlpResolverStack(undefined, {
      // No daemonUrl on purpose: the stub fetch must never be consulted.
      // Resolution falls through to a local spawn of a binary that cannot
      // exist, so the spawn fails fast and deterministically on every
      // machine (this box has a real yt-dlp, which must not be reached).
      daemonFetch,
      ytdlpPath: "yt-dlp-binary-that-does-not-exist",
    });

    await expect(
      resolver.getAudioUrlFromUrl("https://www.youtube.com/watch?v=abc"),
    ).rejects.toThrow();
    expect(daemonFetch).not.toHaveBeenCalled();
  });
});
