import { describe, expect, it } from "vitest";

import {
  buildYtDlpArguments,
  YtDlpJobQueue,
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

class SequencedExecutor implements YtDlpExecutor {
  readonly calls: string[][] = [];

  constructor(private readonly outputs: readonly string[]) {}

  run(argumentsList: readonly string[]): Promise<string> {
    this.calls.push([...argumentsList]);
    const output = this.outputs[this.calls.length - 1] ?? "";
    return Promise.resolve(output);
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

  it("matches YouTube links and exposes the provider name", () => {
    const resolver = new YoutubeResolver(new FakeExecutor(""));

    expect(resolver.name).toBe("youtube");
    expect(resolver.match("https://www.youtube.com/watch?v=abc123")).toBe(true);
    expect(resolver.match("https://youtu.be/abc123")).toBe(true);
    expect(resolver.match("https://www.youtube.com/playlist?list=abc123")).toBe(
      true,
    );
    expect(resolver.match("https://soundcloud.com/artist/track")).toBe(false);
    expect(resolver.match("duki rockstar")).toBe(false);
  });

  it("uses a generated YouTube URL for metadata", async () => {
    const executor = new FakeExecutor(
      '{"id":"abc_123","title":"Example","duration":120,"url":"https://media.example/audio"}',
    );
    const resolver = new YoutubeResolver(executor);

    await expect(
      resolver.getTrack({ id: "abc_123", type: "video" }),
    ).resolves.toEqual({
      audioUrl: "https://media.example/audio",
      durationSeconds: 120,
      id: "abc_123",
      title: "Example",
      webpageUrl: "https://www.youtube.com/watch?v=abc_123",
    });
    expect(executor.calls[0]).toContain("--no-playlist");
    expect(executor.calls[0]).toEqual(
      expect.arrayContaining([
        "--format",
        "bestaudio[acodec!=none]/bestaudio/best[acodec!=none]",
      ]),
    );
  });

  it("selects a relevant result from multiple YouTube candidates", async () => {
    const executor = new FakeExecutor(
      '{"entries":[{"id":"wrong","title":"Unrelated podcast","webpage_url":"https://www.youtube.com/watch?v=wrong"},{"id":"search_1","title":"Duki Rockstar official video","webpage_url":"https://www.youtube.com/watch?v=search_1"}]}',
    );
    const resolver = new YoutubeResolver(executor);

    await expect(resolver.search("duki rockstar")).resolves.toEqual({
      id: "search_1",
      title: "Duki Rockstar official video",
      webpageUrl: "https://www.youtube.com/watch?v=search_1",
    });
    expect(executor.calls[0]).toContain("ytsearch8:duki rockstar");
    expect(executor.calls[0]).toContain("--flat-playlist");
    expect(executor.calls[0]).not.toContain("--format");
    expect(executor.calls[0]).toEqual(
      expect.arrayContaining(["--playlist-end", "8"]),
    );
  });

  it("keeps ranked runner-up candidates as audio fallbacks", async () => {
    const executor = new FakeExecutor(
      '{"entries":[{"id":"best","title":"The Weeknd - Starboy (Official Audio)","webpage_url":"https://www.youtube.com/watch?v=best"},{"id":"topic","title":"The Weeknd - Starboy","webpage_url":"https://www.youtube.com/watch?v=topic"},{"id":"cover","title":"Starboy Cover Remix","webpage_url":"https://www.youtube.com/watch?v=cover"}]}',
    );
    const resolver = new YoutubeResolver(executor);

    await expect(resolver.search("the weeknd starboy")).resolves.toEqual({
      fallbackSources: ["https://www.youtube.com/watch?v=best"],
      id: "topic",
      title: "The Weeknd - Starboy",
      webpageUrl: "https://www.youtube.com/watch?v=topic",
    });
  });

  it("does not treat flat search URLs as playable audio", async () => {
    const executor = new FakeExecutor(
      '{"entries":[{"id":"flat_1","title":"Artist - Song","url":"https://www.youtube.com/watch?v=flat_1"}]}',
    );
    const resolver = new YoutubeResolver(executor);

    await expect(resolver.search("artist song")).resolves.toEqual({
      id: "flat_1",
      title: "Artist - Song",
      webpageUrl: "https://www.youtube.com/watch?v=flat_1",
    });
  });

  it("rejects an empty search result", async () => {
    await expect(
      new YoutubeResolver(new FakeExecutor('{"entries":[]}')).search("missing"),
    ).rejects.toThrow("No encontré una coincidencia confiable");
  });

  it("retries with a shorter query when no candidate is reliable", async () => {
    const executor = new SequencedExecutor([
      '{"entries":[{"id":"wrong","title":"Unrelated podcast","webpage_url":"https://www.youtube.com/watch?v=wrong"}]}',
      '{"entries":[{"id":"search_1","title":"Duki Rockstar official video","webpage_url":"https://www.youtube.com/watch?v=search_1"}]}',
    ]);
    const resolver = new YoutubeResolver(executor);

    await expect(resolver.search("duki rockstar")).resolves.toEqual({
      id: "search_1",
      title: "Duki Rockstar official video",
      webpageUrl: "https://www.youtube.com/watch?v=search_1",
    });
    expect(executor.calls).toHaveLength(2);
    expect(executor.calls[0]).toContain("ytsearch8:duki rockstar");
    expect(executor.calls[1]).toContain("ytsearch8:duki");
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

  it("resolves metadata and audio from a provider URL", async () => {
    const metadataExecutor = new FakeExecutor(
      '{"id":"sc-1","title":"SoundCloud Track","webpage_url":"https://soundcloud.com/artist/track"}',
    );
    await expect(
      new YoutubeResolver(metadataExecutor).getTrackFromUrl(
        "https://soundcloud.com/artist/track",
      ),
    ).resolves.toMatchObject({ id: "sc-1", title: "SoundCloud Track" });
    expect(metadataExecutor.calls[0]).toContain(
      "https://soundcloud.com/artist/track",
    );

    await expect(
      new YoutubeResolver(
        new FakeExecutor("https://media.example/soundcloud\n"),
      ).getAudioUrlFromUrl("https://soundcloud.com/artist/track"),
    ).resolves.toBe("https://media.example/soundcloud");
  });

  it("expands a YouTube playlist without resolving audio", async () => {
    const executor = new FakeExecutor(
      '{"playlist_count":3,"entries":[{"id":"p1","title":"Track One","url":"https://www.youtube.com/watch?v=p1"},{"id":"p2","title":"Track Two","url":"https://www.youtube.com/watch?v=p2"}]}',
    );
    const resolver = new YoutubeResolver(executor);

    await expect(
      resolver.expandPlaylist({ id: "PL123", type: "playlist" }, 20),
    ).resolves.toEqual({
      total: 3,
      tracks: [
        {
          id: "p1",
          title: "Track One",
          webpageUrl: "https://www.youtube.com/watch?v=p1",
        },
        {
          id: "p2",
          title: "Track Two",
          webpageUrl: "https://www.youtube.com/watch?v=p2",
        },
      ],
    });
    expect(executor.calls[0]).toContain("--flat-playlist");
    expect(executor.calls[0]).not.toContain("--format");
    expect(executor.calls[0]).toEqual(
      expect.arrayContaining([
        "--playlist-end",
        "20",
        "https://www.youtube.com/playlist?list=PL123",
      ]),
    );
  });

  it("rejects expanding a video as a playlist", async () => {
    await expect(
      new YoutubeResolver(new FakeExecutor("{}")).expandPlaylist(
        { id: "v1", type: "video" },
        20,
      ),
    ).rejects.toThrow("video cannot be expanded");
  });
});

describe("YtDlpJobQueue", () => {
  it("runs one job at a time and prioritizes playback over queued metadata", async () => {
    const order: string[] = [];
    const releases: Array<() => void> = [];
    const queue = new YtDlpJobQueue(async (label: string) => {
      order.push(label);
      await new Promise<void>((resolve) => releases.push(resolve));
      return label;
    });

    const first = queue.run("metadata-1", "metadata");
    const second = queue.run("metadata-2", "metadata");
    const playback = queue.run("playback", "playback");
    await new Promise((resolve) => setImmediate(resolve));

    expect(order).toEqual(["metadata-1"]);
    releases.shift()?.();
    await new Promise((resolve) => setImmediate(resolve));
    expect(order).toEqual(["metadata-1", "playback"]);
    releases.shift()?.();
    await new Promise((resolve) => setImmediate(resolve));
    expect(order).toEqual(["metadata-1", "playback", "metadata-2"]);
    releases.shift()?.();

    await expect(Promise.all([first, second, playback])).resolves.toEqual([
      "metadata-1",
      "metadata-2",
      "playback",
    ]);
  });
});
