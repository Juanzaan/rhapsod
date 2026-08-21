import { describe, expect, it, vi } from "vitest";

import {
  buildYtDlpArguments,
  buildYtDlpCommand,
  runYtDlpCommand,
  YTDLP_ABORT_ERROR,
  YtDlpJobQueue,
  YoutubeResolver,
  type YtDlpExecutor,
  type YtDlpJobPriority,
  type YoutubePlayerClient,
} from "../src/media/youtube/yt-dlp.js";

class FakeExecutor implements YtDlpExecutor {
  readonly calls: string[][] = [];
  readonly players: Array<string | undefined> = [];

  constructor(private readonly output: string) {}

  run(
    argumentsList: readonly string[],
    _timeoutMs?: number,
    _priority?: YtDlpJobPriority,
    _signal?: AbortSignal,
    playerClient?: YoutubePlayerClient,
  ): Promise<string> {
    this.calls.push([...argumentsList]);
    this.players.push(playerClient);
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
      "--extractor-retries",
      "1",
      "--extractor-args",
      "youtube:player_client=web_safari",
      "--version",
    ]);
  });

  it("overrides the YouTube player client when requested", () => {
    expect(
      buildYtDlpArguments(["--version"], undefined, "web_embedded"),
    ).toContain("youtube:player_client=web_embedded");
  });

  it("lowers yt-dlp priority on Linux so playback wins the CPU", () => {
    expect(
      buildYtDlpCommand("/usr/local/bin/yt-dlp", ["--version"], "linux"),
    ).toEqual({
      file: "nice",
      args: ["-n", "10", "/usr/local/bin/yt-dlp", "--version"],
    });
  });

  it("runs yt-dlp directly on non-Linux platforms", () => {
    expect(
      buildYtDlpCommand("/usr/local/bin/yt-dlp", ["--version"], "win32"),
    ).toEqual({ file: "/usr/local/bin/yt-dlp", args: ["--version"] });
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
    expect(executor.calls[0]).toContain("--ignore-no-formats");
    expect(executor.calls[0]).not.toContain("--format");
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
    expect(executor.calls[0]).toContain("ytsearch20:duki rockstar");
    expect(executor.calls[0]).toContain("--flat-playlist");
    expect(executor.calls[0]).not.toContain("--format");
    expect(executor.calls[0]).toEqual(
      expect.arrayContaining(["--playlist-end", "20"]),
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

  it("prefers the studio version when the expected duration is known", async () => {
    const executor = new FakeExecutor(
      '{"entries":[{"id":"live","title":"Duki Rockstar Live en Estadio","duration":320,"webpage_url":"https://www.youtube.com/watch?v=live"},{"id":"studio","title":"Duki Rockstar Official Video","duration":182,"webpage_url":"https://www.youtube.com/watch?v=studio"}]}',
    );
    const resolver = new YoutubeResolver(executor);

    await expect(resolver.search("duki rockstar", 180)).resolves.toEqual({
      durationSeconds: 182,
      id: "studio",
      title: "Duki Rockstar Official Video",
      webpageUrl: "https://www.youtube.com/watch?v=studio",
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
    expect(executor.calls[0]).toContain("ytsearch20:duki rockstar");
    expect(executor.calls[1]).toContain("ytsearch20:duki");
  });

  it("caches search results so repeated queries skip yt-dlp", async () => {
    const executor = new FakeExecutor(
      JSON.stringify({
        entries: [{ id: "a", title: "Duki Rockstar", duration: 180 }],
      }),
    );
    const resolver = new YoutubeResolver(executor);

    const first = await resolver.search("duki rockstar");
    const second = await resolver.search("duki rockstar");

    expect(second).toEqual(first);
    expect(executor.calls).toHaveLength(1);
  });

  it("shares an in-flight search between concurrent callers", async () => {
    let resolveOutput!: (output: string) => void;
    const runMock = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveOutput = resolve;
        }),
    );
    const executor: YtDlpExecutor = {
      run: runMock,
    };
    const resolver = new YoutubeResolver(executor);

    const first = resolver.search("duki rockstar");
    const second = resolver.search("duki rockstar");
    expect(runMock.mock.calls).toHaveLength(1);

    resolveOutput(
      JSON.stringify({
        entries: [{ id: "a", title: "Duki Rockstar", duration: 180 }],
      }),
    );
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it("refreshes cached searches after the TTL expires", async () => {
    vi.useFakeTimers();
    try {
      const executor = new FakeExecutor(
        JSON.stringify({
          entries: [{ id: "a", title: "Duki Rockstar", duration: 180 }],
        }),
      );
      const resolver = new YoutubeResolver(executor);

      await resolver.search("duki rockstar");
      vi.advanceTimersByTime(15 * 60 * 1000 + 1);
      await resolver.search("duki rockstar");

      expect(executor.calls).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
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

  it("retries the audio URL with another player client when the first fails", async () => {
    const players: Array<string | undefined> = [];
    let calls = 0;
    const executor: YtDlpExecutor = {
      run: (
        _argumentsList: readonly string[],
        _timeoutMs?: number,
        _priority?: YtDlpJobPriority,
        _signal?: AbortSignal,
        playerClient?: YoutubePlayerClient,
      ) => {
        calls++;
        players.push(playerClient);
        return calls === 1
          ? Promise.reject(
              new Error(
                "yt-dlp exited with code 1: Requested format is not available",
              ),
            )
          : Promise.resolve("https://media.example/audio\n");
      },
    };

    await expect(
      new YoutubeResolver(executor).getAudioUrlFromUrl(
        "https://www.youtube.com/watch?v=abc",
      ),
    ).resolves.toBe("https://media.example/audio");
    expect(players).toEqual(["web_safari", "web_embedded"]);
  });

  it("throws the last error when every player client fails", async () => {
    const executor: YtDlpExecutor = {
      run: (
        _argumentsList: readonly string[],
        _timeoutMs?: number,
        _priority?: YtDlpJobPriority,
        _signal?: AbortSignal,
        playerClient?: YoutubePlayerClient,
      ) =>
        playerClient === "web_safari"
          ? Promise.reject(new Error("yt-dlp exited with code 1: boom"))
          : Promise.reject(new Error("yt-dlp exited with code 2: nope")),
    };

    await expect(
      new YoutubeResolver(executor).getAudioUrlFromUrl(
        "https://www.youtube.com/watch?v=abc",
      ),
    ).rejects.toThrow("yt-dlp exited with code 2: nope");
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
  it("reserves a slot for playback while metadata jobs share the remaining capacity", async () => {
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

    expect(order).toEqual(["metadata-1", "playback"]);
    releases.shift()?.();
    await new Promise((resolve) => setImmediate(resolve));
    expect(order).toEqual(["metadata-1", "playback", "metadata-2"]);
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

  it("starts a playback job immediately while a metadata job is in flight", async () => {
    const order: string[] = [];
    const releases: Array<() => void> = [];
    const queue = new YtDlpJobQueue(async (label: string) => {
      order.push(label);
      await new Promise<void>((resolve) => releases.push(resolve));
      return label;
    });

    const metadata = queue.run("metadata-1", "metadata");
    await new Promise((resolve) => setImmediate(resolve));
    expect(order).toEqual(["metadata-1"]);

    const playback = queue.run("playback", "playback");
    await new Promise((resolve) => setImmediate(resolve));
    expect(order).toEqual(["metadata-1", "playback"]);

    releases.shift()?.();
    releases.shift()?.();
    await expect(Promise.all([metadata, playback])).resolves.toEqual([
      "metadata-1",
      "playback",
    ]);
  });

  it("rejects jobs beyond the saturation cap with a friendly error", async () => {
    const releases: Array<() => void> = [];
    const queue = new YtDlpJobQueue(async (label: string) => {
      await new Promise<void>((resolve) => releases.push(resolve));
      return label;
    });

    const accepted = Array.from({ length: 9 }, (_, index) =>
      queue.run(`job-${index}`, "metadata"),
    );
    const over = queue.run("overflow", "metadata");

    expect(releases).toHaveLength(1);
    await expect(over).rejects.toThrow("saturado");

    for (let i = 0; i < 9; i++) {
      releases.shift()?.();
      await new Promise((resolve) => setImmediate(resolve));
    }
    await expect(Promise.all(accepted)).resolves.toHaveLength(9);
  });

  it("rejects an already-aborted job without running it", async () => {
    const execute = vi.fn((label: string) => Promise.resolve(label));
    const queue = new YtDlpJobQueue(execute);
    const controller = new AbortController();
    controller.abort();

    await expect(
      queue.run("job", "metadata", controller.signal),
    ).rejects.toThrow(YTDLP_ABORT_ERROR);
    expect(execute).not.toHaveBeenCalled();
  });

  it("drops queued jobs whose signal is aborted while waiting", async () => {
    const order: string[] = [];
    const releases: Array<() => void> = [];
    const queue = new YtDlpJobQueue(async (label: string) => {
      order.push(label);
      await new Promise<void>((resolve) => releases.push(resolve));
      return label;
    });

    const first = queue.run("first", "metadata");
    const controller = new AbortController();
    const doomed = queue.run("doomed", "metadata", controller.signal);
    const third = queue.run("third", "metadata");
    const doomedExpectation = expect(doomed).rejects.toThrow(YTDLP_ABORT_ERROR);
    await new Promise((resolve) => setImmediate(resolve));

    controller.abort();
    releases.shift()?.();
    await new Promise((resolve) => setImmediate(resolve));

    expect(order).toEqual(["first", "third"]);
    await doomedExpectation;
    releases.shift()?.();
    await expect(Promise.all([first, third])).resolves.toEqual([
      "first",
      "third",
    ]);
  });
});

describe("runYtDlpCommand", () => {
  it("resolves with the child stdout on a clean exit", async () => {
    await expect(
      runYtDlpCommand(
        process.execPath,
        ["-e", "process.stdout.write('hello')"],
        { timeoutMs: 5_000 },
      ),
    ).resolves.toBe("hello");
  });

  it("rejects when the child exits with a non-zero code", async () => {
    await expect(
      runYtDlpCommand(
        process.execPath,
        ["-e", "process.stderr.write('boom'); process.exit(3)"],
        { timeoutMs: 5_000 },
      ),
    ).rejects.toThrow("yt-dlp exited with code 3: boom");
  });

  it("kills a running child when the signal aborts", async () => {
    const controller = new AbortController();
    const pending = runYtDlpCommand(
      process.execPath,
      ["-e", "setInterval(() => {}, 25)"],
      { signal: controller.signal, timeoutMs: 60_000 },
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    controller.abort();

    await expect(pending).rejects.toThrow(YTDLP_ABORT_ERROR);
  });

  it("rejects when the child exceeds the timeout", async () => {
    const pending = runYtDlpCommand(
      process.execPath,
      ["-e", "setInterval(() => {}, 25)"],
      { timeoutMs: 200 },
    );

    await expect(pending).rejects.toThrow("yt-dlp timed out after 200ms");
  });

  it("does not kill a child that runs longer than the abort grace period", async () => {
    await expect(
      runYtDlpCommand(
        process.execPath,
        ["-e", "setTimeout(() => process.stdout.write('slow-ok'), 400)"],
        { abortGraceMs: 100, timeoutMs: 5_000 },
      ),
    ).resolves.toBe("slow-ok");
  });
});
