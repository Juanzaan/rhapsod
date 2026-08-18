import { describe, expect, it } from "vitest";

import {
  buildYtDlpArguments,
  YoutubeResolver,
  type YtDlpExecutor,
} from "../src/media/youtube/yt-dlp.js";

class FakeExecutor implements YtDlpExecutor {
  readonly calls: string[][] = [];

  constructor(private readonly output: string) {}

  run(argumentsList: readonly string[]): Promise<string> {
    this.calls.push([...argumentsList]);
    return Promise.resolve(this.output);
  }
}

describe("YoutubeResolver", () => {
  it("passes a private cookies file to yt-dlp when configured", () => {
    expect(
      buildYtDlpArguments(["--version"], "/run/rhapsod/cookies.txt"),
    ).toEqual([
      "--cookies",
      "/run/rhapsod/cookies.txt",
      "--js-runtimes",
      "node",
      "--remote-components",
      "ejs:github",
      "--version",
    ]);
  });

  it("uses a generated YouTube URL for metadata", async () => {
    const executor = new FakeExecutor(
      '{"id":"abc_123","title":"Example","duration":120}',
    );
    const resolver = new YoutubeResolver(executor);

    await expect(
      resolver.getTrack({ id: "abc_123", type: "video" }),
    ).resolves.toEqual({
      durationSeconds: 120,
      id: "abc_123",
      title: "Example",
      webpageUrl: "https://www.youtube.com/watch?v=abc_123",
    });
    expect(executor.calls[0]).toContain("--no-playlist");
  });

  it("resolves the first YouTube search result", async () => {
    const executor = new FakeExecutor(
      '{"entries":[{"id":"search_1","title":"Found","webpage_url":"https://www.youtube.com/watch?v=search_1"}]}',
    );
    const resolver = new YoutubeResolver(executor);

    await expect(resolver.search("duki rockstar")).resolves.toEqual({
      id: "search_1",
      title: "Found",
      webpageUrl: "https://www.youtube.com/watch?v=search_1",
    });
    expect(executor.calls[0]).toContain("ytsearch1:duki rockstar");
    expect(executor.calls[0]).toContain("--flat-playlist");
    expect(executor.calls[0]).toEqual(
      expect.arrayContaining(["--playlist-end", "1"]),
    );
  });

  it("rejects an empty search result", async () => {
    await expect(
      new YoutubeResolver(new FakeExecutor('{"entries":[]}')).search("missing"),
    ).rejects.toThrow("no YouTube results");
  });

  it("resolves only HTTPS audio endpoints", async () => {
    const resolver = new YoutubeResolver(
      new FakeExecutor("https://media.example/audio\n"),
    );
    await expect(
      resolver.getAudioUrl({ id: "abc", type: "video" }),
    ).resolves.toBe("https://media.example/audio");
    await expect(
      new YoutubeResolver(
        new FakeExecutor("http://insecure.example/audio"),
      ).getAudioUrl({
        id: "abc",
        type: "video",
      }),
    ).rejects.toThrow("HTTPS");
  });
});
