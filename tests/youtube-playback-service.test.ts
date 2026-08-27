import { describe, expect, it, vi, type Mock } from "vitest";

import {
  audioUrlExpiresAt,
  volumeToGain,
  YoutubePlaybackService,
} from "../src/application/youtube-playback-service.js";
import type { YoutubePlaybackResolver } from "../src/application/youtube-playback-service.js";
import type {
  PlaylistExpansion,
  YoutubeTrackMetadata,
} from "../src/media/youtube/yt-dlp.js";
import { SoundCloudDrmError } from "../src/media/soundcloud/public-api.js";
import type { AlternativeSourceResolver } from "../src/media/song-link.js";
import type { FfmpegPlaybackSession } from "../src/audio/ffmpeg-player.js";
import type { SpotifyResolver } from "../src/media/spotify/api.js";
import type { LyricsResolver } from "../src/media/lyrics.js";
import type { AudioPlayer } from "../src/audio/audio-player.js";
import type { RhapsodOpusEncoder } from "../src/audio/opus-encoder.js";
import type { DirectUrlResolver } from "../src/media/direct-url.js";
import type { SerializedQueueTrack } from "../src/domain/state-store.js";
import type { PlaybackState } from "../src/domain/state-store.js";
import { AudioUrlCache } from "../src/application/audio-url-cache.js";
import type { AudioFilter } from "../src/audio/filter-chain.js";

interface TimingCall {
  readonly stage: string;
  readonly cacheHit?: boolean;
  readonly prefetchStatus?: string;
}

function setup(
  options: {
    createPlayback?: () => FfmpegPlaybackSession;
    directUrlResolver?: boolean;
    framesSent?: number;
    lyricsResolver?: boolean;
    maxQueueTracks?: number;
    maxTracksPerUser?: number;
    restoredState?: {
      loopMode?: "off" | "queue" | "track";
      queue?: readonly SerializedQueueTrack[];
      volumePercent?: number;
      filter?: AudioFilter;
    };
    soundcloudResolver?: boolean;
    spotifyResolver?: boolean;
    stateStore?: boolean;
    audioUrlCache?: AudioUrlCache;
  } = {},
) {
  const stopSession = vi.fn();
  const playbackResolvers: Array<() => void> = [];
  const sessionSetVolumeMocks: Mock<(gain: number) => void>[] = [];
  const createPlayback =
    options.createPlayback ??
    vi.fn((): FfmpegPlaybackSession => {
      const setVolume = vi.fn<(gain: number) => void>();
      sessionSetVolumeMocks.push(setVolume);
      return {
        done: new Promise<void>((resolve) => playbackResolvers.push(resolve)),
        player: {
          metrics: {
            bufferedBytes: 0,
            framesSent: options.framesSent ?? 1,
            maxBufferedBytes: 3_840,
            rebufferEvents: 0,
            underruns: 0,
          },
          setVolume,
        } as unknown as AudioPlayer,
        stop: stopSession,
      };
    });
  const resolver = {
    getAudioUrl: vi.fn(() => Promise.resolve("https://media.example/audio")),
    getAudioUrlFromUrl: vi.fn(() =>
      Promise.resolve("https://media.example/audio"),
    ),
    getTrack: vi.fn((resource: { id: string }): Promise<YoutubeTrackMetadata> =>
      Promise.resolve({
        audioUrl: `https://media.example/${resource.id}`,
        id: resource.id,
        title: `Track ${resource.id}`,
        webpageUrl: `https://www.youtube.com/watch?v=${resource.id}`,
      }),
    ),
    getTrackFromUrl: vi.fn((url: string): Promise<YoutubeTrackMetadata> =>
      Promise.resolve({
        audioUrl: "https://media.example/soundcloud-track",
        id: "soundcloud-track",
        title: "SoundCloud Track",
        webpageUrl: url,
      }),
    ),
    search: vi.fn((query: string): Promise<YoutubeTrackMetadata> =>
      Promise.resolve({
        audioUrl: "https://media.example/search-result",
        id: "search-result",
        title: `Search ${query}`,
        webpageUrl: "https://www.youtube.com/watch?v=search-result",
      }),
    ),
    searchMany: vi.fn((query: string): Promise<YoutubeTrackMetadata[]> =>
      Promise.resolve([
        {
          audioUrl: "https://media.example/search-result",
          id: "search-result",
          title: `Search ${query}`,
          webpageUrl: "https://www.youtube.com/watch?v=search-result",
        },
        {
          audioUrl: "https://media.example/search-result-2",
          id: "search-result-2",
          title: `Search ${query} 2`,
          webpageUrl: "https://www.youtube.com/watch?v=search-result-2",
        },
      ]),
    ),
    expandPlaylist: vi.fn<YoutubePlaybackResolver["expandPlaylist"]>(() =>
      Promise.resolve({ tracks: [] }),
    ),
  };
  const encoder: RhapsodOpusEncoder = {
    close: vi.fn(),
    encode: vi.fn(),
    pcmFrameBytes: 3_840,
  };
  const alternativeResolver = {
    findAlternative: vi.fn<AlternativeSourceResolver["findAlternative"]>(() =>
      Promise.resolve({
        provider: "youtube" as const,
        url: "https://youtu.be/fallback",
      }),
    ),
  };
  const soundcloudResolver = {
    getAudioUrl: vi.fn(() =>
      Promise.resolve("https://media.example/soundcloud-api"),
    ),
    getTrack: vi.fn<() => Promise<YoutubeTrackMetadata>>(() =>
      Promise.reject(
        new Error("No se pudo conectar con SoundCloud. Probá de nuevo."),
      ),
    ),
    match: vi.fn((input: string) => input.includes("soundcloud.com")),
    name: "soundcloud",
  };
  const onPlaybackError = vi.fn();
  const onPlaybackFinished = vi.fn();
  const onPlaybackStarted = vi.fn();
  const onTiming = vi.fn<(timing: TimingCall) => void>();
  const spotifyResolver = options.spotifyResolver
    ? {
        expandAlbum: vi.fn<SpotifyResolver["expandAlbum"]>(() =>
          Promise.resolve({ tracks: [], total: 0 }),
        ),
        expandPlaylist: vi.fn<SpotifyResolver["expandPlaylist"]>(() =>
          Promise.resolve({ tracks: [], total: 0 }),
        ),
        getTrack: vi.fn(() =>
          Promise.resolve({
            artist: "Duki",
            durationSeconds: 180,
            id: "abc123",
            title: "Rockstar",
          }),
        ),
        name: "spotify",
      }
    : undefined;
  const directUrlResolverMocks = {
    getAudioUrl: vi.fn((url: string) => Promise.resolve(url)),
    getTrack: vi.fn(() =>
      Promise.resolve({
        id: "direct-1",
        title: "Radio: ice1.somafm.com",
        webpageUrl: "https://ice1.somafm.com/groovesalad-128-mp3",
      }),
    ),
    match: vi.fn(() => Promise.resolve(true)),
  };
  const directUrlResolver: DirectUrlResolver = {
    ...directUrlResolverMocks,
    name: "direct-url",
  };
  const directUrlResolverMock = options.directUrlResolver
    ? directUrlResolver
    : undefined;
  const lyricsResolver = options.lyricsResolver
    ? {
        search: vi.fn<LyricsResolver["search"]>(() =>
          Promise.resolve({
            plainLyrics: "Letra de prueba",
            title: "Rockstar",
          }),
        ),
      }
    : undefined;
  const stateStore = options.stateStore
    ? {
        load: vi.fn(
          () =>
            options.restoredState ?? {
              loopMode: "track" as const,
              volumePercent: 30,
            },
        ),
        save: vi.fn<(state: PlaybackState) => void>(),
        flush: vi.fn(() => Promise.resolve()),
      }
    : undefined;
  const service = new YoutubePlaybackService({
    createPlayback,
    encoder,
    onPlaybackError,
    onPlaybackFinished,
    onPlaybackStarted,
    onTiming,
    output: { sendVoiceFrame: vi.fn() },
    resolver,
    alternativeResolver,
    ...(options.soundcloudResolver ? { soundcloudResolver } : {}),
    ...(directUrlResolverMock
      ? { directUrlResolver: directUrlResolverMock }
      : {}),
    ...(spotifyResolver ? { spotifyResolver } : {}),
    ...(lyricsResolver ? { lyricsResolver } : {}),
    ...(stateStore ? { stateStore } : {}),
    ...(options.audioUrlCache ? { audioUrlCache: options.audioUrlCache } : {}),
    ...(options.maxQueueTracks
      ? { maxQueueTracks: options.maxQueueTracks }
      : {}),
    ...(options.maxTracksPerUser
      ? { maxTracksPerUser: options.maxTracksPerUser }
      : {}),
  });
  return {
    alternativeResolver,
    createPlayback,
    directUrlResolverMocks,
    lyricsResolver,
    onPlaybackError,
    onPlaybackFinished,
    onPlaybackStarted,
    onTiming,
    playbackResolvers,
    resolver,
    service,
    sessionSetVolumeMocks,
    soundcloudResolver,
    spotifyResolver,
    stateStore,
    stopSession,
  };
}

describe("audioUrlExpiresAt", () => {
  it("parses the query-style expire parameter", () => {
    const expiresAt = audioUrlExpiresAt(
      "https://rr5.example/videoplayback?expire=2000000000&ei=x",
    );
    expect(expiresAt).toBe(2_000_000_000_000 - 60_000);
  });

  it("parses the path-style expire segment of manifest URLs", () => {
    const expiresAt = audioUrlExpiresAt(
      "https://manifest.example/api/manifest/hls_playlist/expire/2000000000/ei/x",
    );
    expect(expiresAt).toBe(2_000_000_000_000 - 60_000);
  });

  it("falls back to a conservative TTL without an expire value", () => {
    const before = Date.now();
    const expiresAt = audioUrlExpiresAt("https://media.example/audio");
    expect(expiresAt).toBeGreaterThan(before);
    expect(expiresAt).toBeLessThan(before + 11 * 60_000);
  });
});

describe("YoutubePlaybackService", () => {
  it("queues the first resolved YouTube search result", async () => {
    const { resolver, service } = setup();

    const track = await service.enqueueSearch("duki rockstar", "user-1");

    expect(resolver.search).toHaveBeenCalledWith(
      "duki rockstar",
      undefined,
      "duki",
    );
    expect(track).toMatchObject({
      id: "search-result",
      requestedBy: "user-1",
      title: "Search duki rockstar",
    });
  });

  it("queues a ranked search result by one-based index", async () => {
    const { resolver, service } = setup();

    const track = await service.enqueueSearchIndex(
      "duki rockstar",
      2,
      "user-1",
    );

    expect(resolver.searchMany).toHaveBeenCalledWith(
      "duki rockstar",
      undefined,
      5,
      "duki",
    );
    expect(track).toMatchObject({
      id: "search-result-2",
      title: "Search duki rockstar 2",
    });
  });

  it("rejects an out-of-range search index", async () => {
    const { service } = setup();

    await expect(
      service.enqueueSearchIndex("duki rockstar", 9, "user-1"),
    ).rejects.toThrow("No hay resultado 9");
  });

  it("returns lyrics for the current track, parsed from its title", async () => {
    const { lyricsResolver, resolver, service } = setup({
      lyricsResolver: true,
    });
    resolver.getTrack.mockResolvedValueOnce({
      audioUrl: "https://media.example/lyrics-track",
      id: "lyrics-track",
      title: "Duki - Rockstar (Official Video)",
      webpageUrl: "https://www.youtube.com/watch?v=lyrics-track",
    });

    await service.enqueue("https://youtu.be/lyrics-track", "user-1");
    await new Promise((resolve) => setImmediate(resolve));

    const lyrics = await service.getLyrics();

    expect(lyricsResolver!.search).toHaveBeenCalledWith("Duki", "Rockstar");
    expect(lyrics).toMatchObject({ plainLyrics: "Letra de prueba" });
  });

  it("returns undefined for lyrics when nothing is playing", async () => {
    const { lyricsResolver, service } = setup({ lyricsResolver: true });

    expect(await service.getLyrics()).toBeUndefined();
    expect(lyricsResolver!.search).not.toHaveBeenCalled();
  });

  it("returns undefined for lyrics when the resolver has none", async () => {
    const { lyricsResolver, service } = setup({ lyricsResolver: true });
    lyricsResolver!.search.mockResolvedValueOnce(undefined);
    await service.enqueue("https://youtu.be/abc123", "user-1");
    await new Promise((resolve) => setImmediate(resolve));

    expect(await service.getLyrics()).toBeUndefined();
  });

  it("returns undefined for lyrics when no lyrics resolver is configured", async () => {
    const { service } = setup();
    await service.enqueue("https://youtu.be/abc123", "user-1");
    await new Promise((resolve) => setImmediate(resolve));

    expect(await service.getLyrics()).toBeUndefined();
  });

  it("resolves metadata, queues a track, and resolves audio at playback time", async () => {
    const { createPlayback, onPlaybackStarted, resolver, service } = setup();

    const track = await service.enqueue("https://youtu.be/abc123", "user-1");
    await new Promise((resolve) => setImmediate(resolve));

    expect(track.title).toBe("Track abc123");
    expect(service.current).toEqual(track);
    expect(resolver.getAudioUrlFromUrl).not.toHaveBeenCalled();
    expect(createPlayback).toHaveBeenCalledWith(
      "https://media.example/abc123",
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ audioFilter: { name: "off", param: {} } }),
    );
    expect(onPlaybackStarted).toHaveBeenCalledWith(track);
  });

  it("reports prefetchStatus in-flight while the prefetch promise is pending", async () => {
    const { createPlayback, onTiming, resolver, service } = setup();
    resolver.getTrack.mockResolvedValueOnce({
      id: "abc123",
      title: "Track abc123",
      webpageUrl: "https://www.youtube.com/watch?v=abc123",
    });
    let resolveAudio!: (url: string) => void;
    const pending = new Promise<string>((resolve) => {
      resolveAudio = resolve;
    });
    resolver.getAudioUrlFromUrl.mockReturnValue(pending);

    await service.enqueue("https://youtu.be/abc123", "user-1");
    await new Promise((resolve) => setImmediate(resolve));

    const audioUrlCalls = () =>
      onTiming.mock.calls
        .map((call) => call[0])
        .filter((timing) => timing.stage === "audio-url");
    expect(resolver.getAudioUrlFromUrl).toHaveBeenCalled();
    expect(audioUrlCalls()).toHaveLength(0);

    resolveAudio("https://media.example/audio");
    await new Promise((resolve) => setImmediate(resolve));

    expect(createPlayback).toHaveBeenCalled();
    const timing = audioUrlCalls().at(-1);
    expect(timing?.cacheHit).toBe(true);
    expect(timing?.prefetchStatus).toBe("in-flight");
  });

  it("reports prefetchStatus hit when the prefetch resolves before playback", async () => {
    const { onTiming, playbackResolvers, resolver, service } = setup();
    resolver.getTrack.mockResolvedValueOnce({
      id: "abc123",
      title: "Track abc123",
      webpageUrl: "https://www.youtube.com/watch?v=abc123",
    });
    let resolveAudio!: (url: string) => void;
    resolver.getAudioUrlFromUrl.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveAudio = resolve;
      }),
    );

    await service.enqueue("https://youtu.be/abc123", "user-1");
    await new Promise((resolve) => setImmediate(resolve));
    resolveAudio("https://media.example/audio");
    await new Promise((resolve) => setImmediate(resolve));
    playbackResolvers.shift()?.();

    service.seek(0);
    await new Promise((resolve) => setImmediate(resolve));

    const audioUrlTimings = onTiming.mock.calls
      .map((call) => call[0])
      .filter((timing) => timing.stage === "audio-url");
    expect(audioUrlTimings.at(-1)?.cacheHit).toBe(true);
    expect(audioUrlTimings.at(-1)?.prefetchStatus).toBe("hit");
  });

  it("reports prefetchStatus not-applicable for inline-cached audio URLs", async () => {
    const { onTiming, service } = setup();

    await service.enqueue("https://youtu.be/abc123", "user-1");
    await new Promise((resolve) => setImmediate(resolve));

    const timing = onTiming.mock.calls.at(-1)?.[0] as {
      prefetchStatus?: string;
    };
    expect(timing.prefetchStatus).toBe("not-applicable");
  });

  it("queues and plays a SoundCloud track through the shared resolver", async () => {
    const { resolver, service } = setup();

    const track = await service.enqueue(
      "https://soundcloud.com/artist/track",
      "user-1",
    );

    expect(resolver.getTrackFromUrl).toHaveBeenCalledWith(
      "https://soundcloud.com/artist/track",
    );
    expect(track).toMatchObject({
      id: "soundcloud-track",
      source: "https://soundcloud.com/artist/track",
      title: "SoundCloud Track",
    });
  });

  it("falls back to YouTube when SoundCloud reports DRM", async () => {
    const { resolver, service } = setup();
    resolver.getTrackFromUrl
      .mockRejectedValueOnce(new Error("This video is DRM protected"))
      .mockResolvedValueOnce({
        id: "fallback",
        title: "Fallback Track",
        webpageUrl: "https://www.youtube.com/watch?v=fallback",
      });

    const track = await service.enqueue(
      "https://soundcloud.com/artist/track",
      "user-1",
    );

    expect(resolver.getTrackFromUrl).toHaveBeenNthCalledWith(
      2,
      "https://youtu.be/fallback",
    );
    expect(track).toMatchObject({
      alternativeProvider: "youtube",
      title: "Fallback Track",
    });
  });

  it("falls back to yt-dlp when the public SoundCloud API is unavailable", async () => {
    const { resolver, service } = setup({ soundcloudResolver: true });

    const track = await service.enqueue(
      "https://soundcloud.com/artist/track",
      "user-1",
    );

    expect(resolver.getTrackFromUrl).toHaveBeenCalledWith(
      "https://soundcloud.com/artist/track",
    );
    expect(track.title).toBe("SoundCloud Track");
  });

  it("advances to the next track when playback completes", async () => {
    const { onPlaybackFinished, playbackResolvers, resolver, service } =
      setup();
    resolver.getTrack.mockImplementation((resource: { id: string }) =>
      Promise.resolve({
        ...(resource.id === "first"
          ? { audioUrl: "https://media.example/first" }
          : {}),
        id: resource.id,
        title: `Track ${resource.id}`,
        webpageUrl: `https://www.youtube.com/watch?v=${resource.id}`,
      }),
    );
    await service.enqueue("https://youtu.be/first", "user-1");
    await service.enqueue("https://youtu.be/second", "user-2");
    await new Promise((resolve) => setImmediate(resolve));

    expect(resolver.getAudioUrlFromUrl).toHaveBeenCalledWith(
      "https://www.youtube.com/watch?v=second",
      expect.any(AbortSignal),
    );

    playbackResolvers[0]?.();
    await new Promise((resolve) => setImmediate(resolve));

    expect(service.current?.id).toBe("second");
    expect(onPlaybackFinished).toHaveBeenCalledWith(
      expect.objectContaining({ id: "first" }),
      expect.anything(),
      "completed",
    );
  });

  it("reports skipped and stopped sessions separately", async () => {
    const { onPlaybackFinished, playbackResolvers, service } = setup();
    await service.enqueue("https://youtu.be/first", "user-1");
    await new Promise((resolve) => setImmediate(resolve));

    service.skip();
    playbackResolvers[0]?.();
    await new Promise((resolve) => setImmediate(resolve));
    expect(onPlaybackFinished).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "first" }),
      expect.anything(),
      "skipped",
    );

    await service.enqueue("https://youtu.be/second", "user-1");
    await new Promise((resolve) => setImmediate(resolve));
    service.stop();
    playbackResolvers[1]?.();
    await new Promise((resolve) => setImmediate(resolve));
    expect(onPlaybackFinished).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "second" }),
      expect.anything(),
      "stopped",
    );
  });

  it("coalesces rapid skips into one chain without playing skipped tracks", async () => {
    const {
      createPlayback,
      onPlaybackFinished,
      playbackResolvers,
      resolver,
      service,
    } = setup();
    resolver.getTrack.mockImplementation((resource: { id: string }) =>
      Promise.resolve({
        ...(resource.id === "first"
          ? { audioUrl: "https://media.example/first" }
          : {}),
        id: resource.id,
        title: `Track ${resource.id}`,
        webpageUrl: `https://www.youtube.com/watch?v=${resource.id}`,
      }),
    );
    for (const id of ["first", "second", "third", "fourth"]) {
      await service.enqueue(`https://youtu.be/${id}`, "user-1");
    }
    await new Promise((resolve) => setImmediate(resolve));

    expect(service.current?.id).toBe("first");
    expect(createPlayback).toHaveBeenCalledTimes(1);

    service.skip();
    service.skip();
    service.skip();
    service.skip();
    playbackResolvers[0]?.();
    await new Promise((resolve) => setImmediate(resolve));

    expect(createPlayback).toHaveBeenCalledTimes(1);
    expect(service.current).toBeUndefined();
    expect(service.queue()).toHaveLength(0);
    expect(onPlaybackFinished).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "first" }),
      expect.anything(),
      "skipped",
    );
  });

  it("skips tracks queued behind a mid-resolution skip exactly once", async () => {
    const { createPlayback, resolver, service } = setup();
    const deferred: Array<() => void> = [];
    resolver.getTrack.mockImplementation((resource: { id: string }) =>
      Promise.resolve({
        id: resource.id,
        title: `Track ${resource.id}`,
        webpageUrl: `https://www.youtube.com/watch?v=${resource.id}`,
      }),
    );
    resolver.getAudioUrlFromUrl.mockImplementation(
      ((url: string) =>
        new Promise<string>((resolve) => {
          deferred.push(() => resolve(`https://media.example/${url}`));
        })) as unknown as () => Promise<string>,
    );

    await service.enqueue("https://youtu.be/first", "user-1");
    await service.enqueue("https://youtu.be/second", "user-1");
    await service.enqueue("https://youtu.be/third", "user-1");
    await new Promise((resolve) => setImmediate(resolve));

    expect(service.current?.id).toBe("first");
    expect(deferred).toHaveLength(1);

    service.skip();
    deferred[0]?.();
    await new Promise((resolve) => setImmediate(resolve));
    deferred[1]?.();
    await new Promise((resolve) => setImmediate(resolve));

    expect(service.current?.id).toBe("second");
    expect(createPlayback).toHaveBeenCalledTimes(1);
    expect(resolver.getAudioUrlFromUrl).toHaveBeenCalledTimes(3);
  });

  it("prefetches the next track only after the first frame is sent", async () => {
    const metrics = {
      bufferedBytes: 0,
      framesSent: 0,
      maxBufferedBytes: 0,
      rebufferEvents: 0,
      underruns: 0,
    };
    const { playbackResolvers, resolver, service } = setup({
      createPlayback: () => {
        const setVolume = vi.fn<(gain: number) => void>();
        return {
          done: new Promise<void>((resolve) => playbackResolvers.push(resolve)),
          player: {
            metrics,
            setVolume,
          } as unknown as AudioPlayer,
          stop: vi.fn(),
        };
      },
    });
    resolver.getTrack.mockImplementation((resource: { id: string }) =>
      Promise.resolve({
        ...(resource.id === "first"
          ? { audioUrl: "https://media.example/first" }
          : {}),
        id: resource.id,
        title: `Track ${resource.id}`,
        webpageUrl: `https://www.youtube.com/watch?v=${resource.id}`,
      }),
    );

    await service.enqueue("https://youtu.be/first", "user-1");
    await service.enqueue("https://youtu.be/second", "user-1");
    await new Promise((resolve) => setImmediate(resolve));

    expect(service.current?.id).toBe("first");
    expect(resolver.getAudioUrlFromUrl).not.toHaveBeenCalled();

    metrics.framesSent = 1;
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(resolver.getAudioUrlFromUrl).toHaveBeenCalledWith(
      "https://www.youtube.com/watch?v=second",
      expect.any(AbortSignal),
    );
  });

  it("prefetches several tracks ahead so rapid skips stay responsive", async () => {
    const metrics = {
      bufferedBytes: 0,
      framesSent: 0,
      maxBufferedBytes: 0,
      rebufferEvents: 0,
      underruns: 0,
    };
    const { playbackResolvers, resolver, service } = setup({
      createPlayback: () => {
        const setVolume = vi.fn<(gain: number) => void>();
        return {
          done: new Promise<void>((resolve) => playbackResolvers.push(resolve)),
          player: {
            metrics,
            setVolume,
          } as unknown as AudioPlayer,
          stop: vi.fn(),
        };
      },
    });
    resolver.getTrack.mockImplementation((resource: { id: string }) =>
      Promise.resolve({
        ...(resource.id === "first"
          ? { audioUrl: "https://media.example/first" }
          : {}),
        id: resource.id,
        title: `Track ${resource.id}`,
        webpageUrl: `https://www.youtube.com/watch?v=${resource.id}`,
      }),
    );

    await service.enqueue("https://youtu.be/first", "user-1");
    await service.enqueue("https://youtu.be/second", "user-1");
    await service.enqueue("https://youtu.be/third", "user-1");
    await new Promise((resolve) => setImmediate(resolve));

    expect(service.current?.id).toBe("first");

    metrics.framesSent = 1;
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(resolver.getAudioUrlFromUrl).toHaveBeenCalledWith(
      "https://www.youtube.com/watch?v=second",
      expect.any(AbortSignal),
    );
    expect(resolver.getAudioUrlFromUrl).toHaveBeenCalledWith(
      "https://www.youtube.com/watch?v=third",
      expect.any(AbortSignal),
    );
  });

  it("does not start a new session when the queue empties from rapid skips", async () => {
    const { createPlayback, playbackResolvers, resolver, service } = setup();
    resolver.getTrack.mockImplementation((resource: { id: string }) =>
      Promise.resolve({
        ...(resource.id === "first"
          ? { audioUrl: "https://media.example/first" }
          : {}),
        id: resource.id,
        title: `Track ${resource.id}`,
        webpageUrl: `https://www.youtube.com/watch?v=${resource.id}`,
      }),
    );
    await service.enqueue("https://youtu.be/first", "user-1");
    await service.enqueue("https://youtu.be/second", "user-1");
    await new Promise((resolve) => setImmediate(resolve));
    expect(createPlayback).toHaveBeenCalledTimes(1);

    service.skip();
    service.skip();
    playbackResolvers[0]?.();
    await new Promise((resolve) => setImmediate(resolve));

    expect(service.current).toBeUndefined();
    expect(createPlayback).toHaveBeenCalledTimes(1);
    expect(resolver.getAudioUrlFromUrl).toHaveBeenCalledTimes(1);
  });

  it("falls back to resolving playback when prefetched audio fails", async () => {
    const { playbackResolvers, resolver, service } = setup();
    resolver.getTrack.mockImplementation((resource: { id: string }) =>
      Promise.resolve({
        ...(resource.id === "first"
          ? { audioUrl: "https://media.example/first" }
          : {}),
        id: resource.id,
        title: `Track ${resource.id}`,
        webpageUrl: `https://www.youtube.com/watch?v=${resource.id}`,
      }),
    );
    resolver.getAudioUrlFromUrl
      .mockRejectedValueOnce(new Error("prefetch failed"))
      .mockResolvedValueOnce("https://media.example/fallback");

    await service.enqueue("https://youtu.be/first", "user-1");
    await service.enqueue("https://youtu.be/second", "user-2");
    await new Promise((resolve) => setImmediate(resolve));
    playbackResolvers[0]?.();
    await new Promise((resolve) => setImmediate(resolve));

    expect(resolver.getAudioUrlFromUrl).toHaveBeenCalledTimes(2);
    expect(service.current?.id).toBe("second");
  });

  it("stops the active session and clears the queue", async () => {
    const { service, stopSession } = setup();
    await service.enqueue("https://youtu.be/first", "user-1");
    await service.enqueue("https://youtu.be/second", "user-2");
    await new Promise((resolve) => setImmediate(resolve));

    service.stop();

    expect(stopSession).toHaveBeenCalled();
    expect(service.current).toBeUndefined();
    expect(service.queue()).toEqual([]);
  });

  it("queues a single track from a music service link", async () => {
    const { alternativeResolver, resolver, service } = setup();
    alternativeResolver.findAlternative.mockResolvedValue({
      provider: "youtube",
      url: "https://youtu.be/fallback",
    });

    const result = await service.enqueueMusicLink(
      "https://music.apple.com/us/album/titulo/123?i=456",
      "user-1",
    );

    expect(resolver.getTrack).toHaveBeenCalledWith({
      id: "fallback",
      type: "video",
    });
    expect(result.added).toHaveLength(1);
    expect(result.added[0]).toMatchObject({
      id: "fallback",
      requestedBy: "user-1",
    });
  });

  it("expands a music service link that resolves to a YouTube playlist", async () => {
    const { alternativeResolver, resolver, service } = setup();
    alternativeResolver.findAlternative.mockResolvedValue({
      provider: "youtube",
      url: "https://www.youtube.com/playlist?list=PLabc123",
    });
    resolver.expandPlaylist.mockResolvedValue({
      tracks: [
        {
          id: "t1",
          title: "Track 1",
          webpageUrl: "https://www.youtube.com/watch?v=t1",
        },
        {
          id: "t2",
          title: "Track 2",
          webpageUrl: "https://www.youtube.com/watch?v=t2",
        },
      ],
      total: 2,
    });

    const result = await service.enqueueMusicLink(
      "https://music.amazon.com/albums/B0ABC123",
      "user-1",
    );

    expect(result.added).toHaveLength(2);
    expect(result.remaining).toBe(0);
  });

  it("plays a SoundCloud alternative when the music service link has no YouTube match", async () => {
    const { alternativeResolver, service, soundcloudResolver } = setup({
      soundcloudResolver: true,
    });
    alternativeResolver.findAlternative.mockResolvedValue({
      provider: "soundcloud",
      url: "https://soundcloud.com/artist/track",
    });
    soundcloudResolver.getTrack.mockResolvedValue({
      audioUrl: "https://media.example/soundcloud-api",
      id: "sc-track",
      title: "SoundCloud Track",
      webpageUrl: "https://soundcloud.com/artist/track",
    });

    const result = await service.enqueueMusicLink(
      "https://music.apple.com/us/album/titulo/123?i=456",
      "user-1",
    );

    expect(soundcloudResolver.getTrack).toHaveBeenCalledWith(
      "https://soundcloud.com/artist/track",
    );
    expect(result.added[0]).toMatchObject({ id: "sc-track" });
  });

  it("rejects music service links with no resolvable alternative", async () => {
    const { alternativeResolver, service } = setup();
    alternativeResolver.findAlternative.mockResolvedValue(undefined);

    await expect(
      service.enqueueMusicLink(
        "https://music.apple.com/us/album/x/1?i=2",
        "user-1",
      ),
    ).rejects.toThrow("No pude encontrar ese link en YouTube o SoundCloud");
  });

  it("resolves Apple Music and Amazon Music links through the main enqueue path", async () => {
    const { service } = setup();

    const appleTrack = await service.enqueue(
      "https://music.apple.com/us/album/titulo/123?i=456",
      "user-1",
    );
    expect(appleTrack.id).toBe("fallback");

    const amazonTrack = await service.enqueue(
      "https://music.amazon.com/albums/B0ABC123?trackAsin=B0XYZ",
      "user-2",
    );
    expect(amazonTrack.id).toBe("fallback");
  });

  it("applies the volume to the active and future sessions", async () => {
    const { service, sessionSetVolumeMocks } = setup();
    await service.enqueue("https://youtu.be/first", "user-1");
    await new Promise((resolve) => setImmediate(resolve));
    expect(sessionSetVolumeMocks[0]).toHaveBeenCalledWith(volumeToGain(50));

    service.setVolume(30);
    expect(sessionSetVolumeMocks[0]).toHaveBeenLastCalledWith(
      expect.closeTo(0.0398, 4),
    );
    expect(service.volume).toBe(30);
  });

  it("maps the volume percent with a perceptual gain curve", () => {
    expect(volumeToGain(100)).toBe(1);
    expect(volumeToGain(50)).toBeCloseTo(0.1, 5);
    expect(volumeToGain(0)).toBeCloseTo(0.01, 5);
  });

  it("re-enqueues the finished track in track loop mode", async () => {
    const { createPlayback, playbackResolvers, service } = setup();
    service.setLoopMode("track");
    await service.enqueue("https://youtu.be/first", "user-1");
    await new Promise((resolve) => setImmediate(resolve));
    expect(createPlayback).toHaveBeenCalledTimes(1);

    playbackResolvers[0]?.();
    await new Promise((resolve) => setImmediate(resolve));

    expect(createPlayback).toHaveBeenCalledTimes(2);
    expect(createPlayback).toHaveBeenNthCalledWith(
      2,
      "https://media.example/audio",
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ audioFilter: { name: "off", param: {} } }),
    );
    expect(service.current?.id).toBe("first");
  });

  it("replays the queue from the beginning in queue loop mode", async () => {
    const { createPlayback, playbackResolvers, service } = setup();
    await service.enqueue("https://youtu.be/first", "user-1");
    await service.enqueue("https://youtu.be/second", "user-2");
    await new Promise((resolve) => setImmediate(resolve));
    service.setLoopMode("queue");
    expect(service.loopMode).toBe("queue");

    playbackResolvers[0]?.();
    await new Promise((resolve) => setImmediate(resolve));
    playbackResolvers[1]?.();
    await new Promise((resolve) => setImmediate(resolve));

    expect(createPlayback).toHaveBeenCalledTimes(3);
    expect(createPlayback).toHaveBeenNthCalledWith(
      3,
      "https://media.example/audio",
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ audioFilter: { name: "off", param: {} } }),
    );
  });

  it("does not loop the finished track after a skip", async () => {
    const { createPlayback, playbackResolvers, service } = setup();
    service.setLoopMode("track");
    await service.enqueue("https://youtu.be/first", "user-1");
    await new Promise((resolve) => setImmediate(resolve));

    service.skip();
    playbackResolvers[0]?.();
    await new Promise((resolve) => setImmediate(resolve));

    expect(createPlayback).toHaveBeenCalledTimes(1);
    expect(service.current).toBeUndefined();
  });

  it("disables looping when the queue is cleared or stopped", async () => {
    const { playbackResolvers, service } = setup();
    service.setLoopMode("queue");
    await service.enqueue("https://youtu.be/first", "user-1");
    await new Promise((resolve) => setImmediate(resolve));
    service.clearQueued();

    playbackResolvers[0]?.();
    await new Promise((resolve) => setImmediate(resolve));

    expect(service.loopMode).toBe("off");
    expect(service.current).toBeUndefined();
  });

  it("removes queued tracks without stopping the current track", async () => {
    const { service } = setup();
    await service.enqueue("https://youtu.be/first", "user-1");
    await service.enqueue("https://youtu.be/second", "user-2");
    await new Promise((resolve) => setImmediate(resolve));

    expect(service.removeQueued(1)?.id).toBe("second");
    expect(service.queue()).toEqual([]);
    expect(service.current?.id).toBe("first");
  });

  it("shuffles only the pending tracks", async () => {
    const { service } = setup();
    await service.enqueue("https://youtu.be/first", "user-1");
    await service.enqueue("https://youtu.be/second", "user-2");
    await service.enqueue("https://youtu.be/third", "user-3");
    await new Promise((resolve) => setImmediate(resolve));

    expect(service.shuffleQueued()).toBe(2);
    expect(service.current?.id).toBe("first");
    expect(service.queue()).toHaveLength(2);
  });

  it("carries the track duration into the queue", async () => {
    const { resolver, service } = setup();
    resolver.getTrack.mockResolvedValueOnce({
      durationSeconds: 120,
      id: "first",
      title: "Track first",
      webpageUrl: "https://www.youtube.com/watch?v=first",
    });

    const track = await service.enqueue("https://youtu.be/first", "user-1");

    expect(track.durationSeconds).toBe(120);
  });

  it("reports playback failures without blocking the chain", async () => {
    const { onPlaybackError, resolver, service } = setup();
    resolver.getTrack.mockResolvedValueOnce({
      id: "failed",
      title: "Track failed",
      webpageUrl: "https://www.youtube.com/watch?v=failed",
    });
    resolver.getAudioUrlFromUrl.mockRejectedValueOnce(
      new Error("audio unavailable"),
    );

    await service.enqueue("https://youtu.be/failed", "user-1");
    await new Promise((resolve) => setImmediate(resolve));

    expect(onPlaybackError).toHaveBeenCalledWith(
      expect.objectContaining({ id: "failed" }),
      expect.objectContaining({ message: "audio unavailable" }),
    );
  });

  it("rejects unsupported providers before queueing", async () => {
    const { service } = setup();

    await expect(
      service.enqueue("https://open.spotify.com/track/abc123", "user-1"),
    ).rejects.toThrow("Spotify no está configurado en este bot");
  });

  it("resolves Spotify tracks through a YouTube search", async () => {
    const { resolver, service, spotifyResolver } = setup({
      spotifyResolver: true,
    });

    const track = await service.enqueue(
      "https://open.spotify.com/track/abc123",
      "user-1",
    );

    expect(spotifyResolver!.getTrack).toHaveBeenCalledWith({
      id: "abc123",
      type: "track",
    });
    expect(resolver.search).toHaveBeenCalledWith(
      "Duki Rockstar",
      180,
      "Rockstar",
    );
    expect(track).toMatchObject({
      alternativeProvider: "spotify",
      id: "search-result",
      requestedBy: "user-1",
    });
  });

  it("rejects Spotify collections through the single-track path", async () => {
    const { service } = setup({ spotifyResolver: true });

    await expect(
      service.enqueue("https://open.spotify.com/playlist/abc123", "user-1"),
    ).rejects.toThrow("se expanden con !play");
    await expect(
      service.enqueue("https://open.spotify.com/album/abc123", "user-1"),
    ).rejects.toThrow("se expanden con !play");
  });

  it("enqueues Spotify playlist tracks immediately and resolves them lazily", async () => {
    const { createPlayback, resolver, service, spotifyResolver } = setup({
      spotifyResolver: true,
    });
    spotifyResolver!.expandPlaylist.mockResolvedValueOnce({
      tracks: [
        {
          artist: "Duki",
          durationSeconds: 180,
          id: "t1",
          title: "Rockstar",
        },
        {
          artist: "Kanye West",
          durationSeconds: 271,
          id: "t2",
          title: "Ghost Town",
        },
      ],
      total: 25,
    });

    const result = await service.enqueueSpotifyCollection(
      { id: "p1", type: "playlist" },
      "user-1",
    );

    expect(result.added).toHaveLength(2);
    expect(result.remaining).toBe(23);
    expect(resolver.search).toHaveBeenCalledTimes(1);
    expect(resolver.search).toHaveBeenCalledWith(
      "Duki Rockstar",
      180,
      "Rockstar",
    );
    expect(result.added[0]).toMatchObject({
      alternativeProvider: "spotify",
      id: "t1",
      requestedBy: "user-1",
      searchQuery: "Duki Rockstar",
      source: "https://open.spotify.com/track/t1",
      title: "Rockstar",
    });
    expect(result.added[1]).toMatchObject({
      id: "t2",
      searchQuery: "Kanye West Ghost Town",
      title: "Ghost Town",
    });
    expect(service.queue()).toHaveLength(1);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(resolver.search).toHaveBeenCalledWith(
      "Duki Rockstar",
      180,
      "Rockstar",
    );
    expect(resolver.search).toHaveBeenCalledWith(
      "Kanye West Ghost Town",
      271,
      "Ghost Town",
    );
    expect(createPlayback).toHaveBeenCalledTimes(1);
  });

  it("clears the queue after an instant Spotify expansion", async () => {
    const { createPlayback, resolver, service, spotifyResolver } = setup({
      spotifyResolver: true,
    });
    let releaseSearch: (() => void) | undefined;
    resolver.search.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseSearch = () =>
            resolve({
              audioUrl: "https://media.example/one",
              id: "yt-one",
              title: "One",
              webpageUrl: "https://www.youtube.com/watch?v=one",
            });
        }),
    );
    resolver.search.mockResolvedValue({
      audioUrl: "https://media.example/two",
      id: "yt-two",
      title: "Two",
      webpageUrl: "https://www.youtube.com/watch?v=two",
    });
    spotifyResolver!.expandPlaylist.mockResolvedValueOnce({
      tracks: [
        { artist: "A", durationSeconds: 100, id: "x1", title: "One" },
        { artist: "B", durationSeconds: 200, id: "x2", title: "Two" },
        { artist: "C", durationSeconds: 300, id: "x3", title: "Three" },
      ],
    });

    const result = await service.enqueueSpotifyCollection(
      { id: "p1", type: "playlist" },
      "user-1",
    );

    expect(result.added).toHaveLength(3);
    await new Promise((resolve) => setImmediate(resolve));
    expect(releaseSearch).toBeDefined();

    service.clearQueued();
    releaseSearch?.();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(service.queue()).toHaveLength(0);
    expect(service.current).toBeUndefined();
    expect(createPlayback).not.toHaveBeenCalled();
  });

  it("reports a playback creation failure and drains the queue", async () => {
    const { onPlaybackError, service } = setup({
      createPlayback: () => {
        throw new Error("ffmpeg binary missing");
      },
    });

    await service.enqueue("https://youtu.be/first", "user-1");
    await service.enqueue("https://youtu.be/second", "user-1");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(onPlaybackError).toHaveBeenCalledTimes(2);
    expect(
      onPlaybackError.mock.calls.map(([, error]) => (error as Error).message),
    ).toEqual(["ffmpeg binary missing", "ffmpeg binary missing"]);
    expect(service.current).toBeUndefined();
    expect(service.queue()).toHaveLength(0);
  });

  it("skips Spotify tracks with no reliable YouTube match", async () => {
    const {
      createPlayback,
      onPlaybackError,
      resolver,
      service,
      spotifyResolver,
    } = setup({ spotifyResolver: true });
    resolver.search.mockRejectedValueOnce(new Error("no match"));
    spotifyResolver!.expandPlaylist.mockResolvedValueOnce({
      tracks: [
        { artist: "A", durationSeconds: 100, id: "x1", title: "One" },
        { artist: "B", durationSeconds: 200, id: "x2", title: "Two" },
      ],
    });

    const result = await service.enqueueSpotifyCollection(
      { id: "p1", type: "playlist" },
      "user-1",
    );

    expect(result.added).toHaveLength(2);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(service.current?.title).toBe("Two");
    expect(service.queue()).toHaveLength(0);
    expect(createPlayback).toHaveBeenCalledTimes(1);
    expect(onPlaybackError).toHaveBeenCalledTimes(1);
  });

  it("expands Spotify albums through the album endpoint", async () => {
    const { service, spotifyResolver } = setup({ spotifyResolver: true });

    const result = await service.enqueueSpotifyCollection(
      { id: "a1", type: "album" },
      "user-1",
    );

    expect(spotifyResolver!.expandAlbum).toHaveBeenCalledWith(
      { id: "a1", type: "album" },
      100,
    );
    expect(result.added).toEqual([]);
    expect(result.remaining).toBe(0);
  });

  it("falls back to a YouTube search when given plain text", async () => {
    const { resolver, service } = setup();

    const track = await service.enqueue("duki rockstar", "user-1");

    expect(resolver.search).toHaveBeenCalledWith(
      "duki rockstar",
      undefined,
      "duki",
    );
    expect(track).toMatchObject({
      id: "search-result",
      requestedBy: "user-1",
      title: "Search duki rockstar",
    });
  });

  it("rejects explicit local file inputs", async () => {
    const { service } = setup();

    await expect(
      service.enqueue("file:/tmp/song.mp3", "user-1"),
    ).rejects.toThrow("Los archivos locales no están soportados");
  });

  it("rejects unrecognized generic URLs", async () => {
    const { service } = setup();

    await expect(
      service.enqueue("https://example.com/some-page", "user-1"),
    ).rejects.toThrow("No reconozco ese link");
  });

  it("falls back to the next ranked candidate when audio is unavailable", async () => {
    const { createPlayback, onPlaybackError, resolver, service } = setup();
    resolver.getTrack.mockResolvedValueOnce({
      fallbackSources: ["https://www.youtube.com/watch?v=second"],
      id: "best",
      title: "Track best",
      webpageUrl: "https://www.youtube.com/watch?v=best",
    });
    resolver.getAudioUrlFromUrl
      .mockRejectedValueOnce(new Error("Requested format is not available"))
      .mockResolvedValueOnce("https://media.example/second-audio");

    await service.enqueue("https://youtu.be/best", "user-1");
    await new Promise((resolve) => setImmediate(resolve));

    expect(resolver.getAudioUrlFromUrl).toHaveBeenNthCalledWith(
      1,
      "https://www.youtube.com/watch?v=best",
      expect.any(AbortSignal),
    );
    expect(resolver.getAudioUrlFromUrl).toHaveBeenNthCalledWith(
      2,
      "https://www.youtube.com/watch?v=second",
      expect.any(AbortSignal),
    );
    expect(createPlayback).toHaveBeenCalledWith(
      "https://media.example/second-audio",
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ audioFilter: { name: "off", param: {} } }),
    );
    expect(onPlaybackError).not.toHaveBeenCalled();
  });

  it("resolves fallback candidates in parallel when the winner has no audio", async () => {
    const { createPlayback, onPlaybackError, resolver, service } = setup();
    resolver.getTrack.mockResolvedValueOnce({
      fallbackSources: [
        "https://www.youtube.com/watch?v=second",
        "https://www.youtube.com/watch?v=third",
      ],
      id: "best",
      title: "Track best",
      webpageUrl: "https://www.youtube.com/watch?v=best",
    });
    resolver.getAudioUrlFromUrl
      .mockRejectedValueOnce(new Error("Requested format is not available"))
      .mockResolvedValueOnce("https://media.example/second-audio")
      .mockRejectedValueOnce(new Error("Requested format is not available"));

    await service.enqueue("https://youtu.be/best", "user-1");
    await new Promise((resolve) => setImmediate(resolve));

    expect(resolver.getAudioUrlFromUrl).toHaveBeenCalledWith(
      "https://www.youtube.com/watch?v=best",
      expect.any(AbortSignal),
    );
    expect(resolver.getAudioUrlFromUrl).toHaveBeenCalledWith(
      "https://www.youtube.com/watch?v=second",
      expect.any(AbortSignal),
    );
    expect(resolver.getAudioUrlFromUrl).toHaveBeenCalledWith(
      "https://www.youtube.com/watch?v=third",
      expect.any(AbortSignal),
    );
    expect(createPlayback).toHaveBeenCalledWith(
      "https://media.example/second-audio",
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ audioFilter: { name: "off", param: {} } }),
    );
    expect(onPlaybackError).not.toHaveBeenCalled();
  });

  it("uses the first successful fallback without waiting for slower candidates", async () => {
    const { createPlayback, resolver, service } = setup();
    resolver.getTrack.mockResolvedValueOnce({
      fallbackSources: [
        "https://www.youtube.com/watch?v=second",
        "https://www.youtube.com/watch?v=third",
      ],
      id: "best",
      title: "Track best",
      webpageUrl: "https://www.youtube.com/watch?v=best",
    });
    let resolveWinner!: (url: string) => void;
    const slow = new Promise<string>(() => undefined);
    resolver.getAudioUrlFromUrl
      .mockRejectedValueOnce(new Error("Requested format is not available"))
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveWinner = resolve;
          }),
      )
      .mockImplementationOnce(() => slow);

    await service.enqueue("https://youtu.be/best", "user-1");
    await new Promise((resolve) => setImmediate(resolve));
    resolveWinner("https://media.example/second-audio");
    await new Promise((resolve) => setImmediate(resolve));

    expect(createPlayback).toHaveBeenCalledWith(
      "https://media.example/second-audio",
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ audioFilter: { name: "off", param: {} } }),
    );
  });

  it("reports a clear message when YouTube requires authentication", async () => {
    const { onPlaybackError, resolver, service } = setup();
    resolver.getTrack.mockImplementation((resource: { id: string }) =>
      Promise.resolve({
        id: resource.id,
        title: `Track ${resource.id}`,
        webpageUrl: `https://www.youtube.com/watch?v=${resource.id}`,
      }),
    );
    resolver.getAudioUrlFromUrl.mockRejectedValue(
      new Error(
        "Sign in to confirm you're not a bot. Use --cookies-from-browser or --cookies for the authentication.",
      ),
    );

    await service.enqueue("https://youtu.be/auth-fail", "user-1");
    await new Promise((resolve) => setImmediate(resolve));

    expect(onPlaybackError).toHaveBeenCalledWith(
      expect.objectContaining({ id: "auth-fail" }),
      expect.objectContaining({
        message:
          "YouTube pidió autenticación: probablemente las cookies del bot estén vencidas.",
      }),
    );
  });

  it("reports the failure when every candidate has no playable audio", async () => {
    const { onPlaybackError, resolver, service } = setup();
    resolver.getTrack.mockResolvedValueOnce({
      fallbackSources: ["https://www.youtube.com/watch?v=second"],
      id: "best",
      title: "Track best",
      webpageUrl: "https://www.youtube.com/watch?v=best",
    });
    resolver.getAudioUrlFromUrl.mockRejectedValue(
      new Error("Requested format is not available"),
    );

    await service.enqueue("https://youtu.be/best", "user-1");
    await new Promise((resolve) => setImmediate(resolve));

    expect(onPlaybackError).toHaveBeenCalledWith(
      expect.objectContaining({ id: "best" }),
      expect.objectContaining({
        message: "Requested format is not available",
      }),
    );
  });

  it("searches YouTube by metadata when SoundCloud is DRM without a SongLink match", async () => {
    const { alternativeResolver, resolver, service } = setup();
    alternativeResolver.findAlternative.mockResolvedValueOnce(undefined);
    resolver.getTrackFromUrl.mockRejectedValueOnce(
      new SoundCloudDrmError({
        artist: "Kanye West",
        durationSeconds: 224,
        title: "OK (feat. Don Toliver)",
      }),
    );
    resolver.search.mockResolvedValueOnce({
      id: "yt-fallback",
      title: "Kanye West - OK (Official Audio)",
      webpageUrl: "https://www.youtube.com/watch?v=yt-fallback",
    });

    const track = await service.enqueue(
      "https://on.soundcloud.com/0Tbj4O1F7XxfV6DDjQ",
      "user-1",
    );

    expect(resolver.search).toHaveBeenCalledWith(
      "Kanye West OK (feat. Don Toliver)",
      224,
      "OK (feat. Don Toliver)",
    );
    expect(track).toMatchObject({
      alternativeProvider: "youtube",
      id: "yt-fallback",
      title: "Kanye West - OK (Official Audio)",
    });
  });

  it("keeps the DRM error when metadata search finds no reliable match", async () => {
    const { alternativeResolver, resolver, service } = setup();
    alternativeResolver.findAlternative.mockResolvedValueOnce(undefined);
    resolver.getTrackFromUrl.mockRejectedValueOnce(
      new SoundCloudDrmError({
        artist: "Kanye West",
        title: "OK (feat. Don Toliver)",
      }),
    );
    resolver.search.mockRejectedValueOnce(
      new Error("No encontré una coincidencia confiable en YouTube"),
    );

    await expect(
      service.enqueue("https://on.soundcloud.com/0Tbj4O1F7XxfV6DDjQ", "user-1"),
    ).rejects.toThrow("DRM protected");
  });

  it("enqueues a YouTube playlist up to the limit and reports the remainder", async () => {
    const { resolver, service } = setup();
    resolver.expandPlaylist.mockResolvedValueOnce({
      total: 5,
      tracks: [1, 2, 3].map((index) => ({
        id: `p${index}`,
        title: `Playlist Track ${index}`,
        webpageUrl: `https://www.youtube.com/watch?v=p${index}`,
      })),
    });

    const result = await service.enqueuePlaylist(
      { id: "PL1", type: "playlist" },
      "user-1",
    );

    expect(resolver.expandPlaylist).toHaveBeenCalledWith(
      { id: "PL1", type: "playlist" },
      100,
    );
    expect(result).toMatchObject({
      added: [
        expect.objectContaining({
          id: "p1",
          requestedBy: "user-1",
          title: "Playlist Track 1",
        }),
        expect.objectContaining({ id: "p2" }),
        expect.objectContaining({ id: "p3" }),
      ],
      remaining: 2,
    });
    expect(service.current?.id).toBe("p1");
    expect(service.queue()).toHaveLength(2);
  });

  it("does not enqueue a playlist that finishes after stop", async () => {
    const { resolver, service } = setup();
    let resolveExpansion!: (expansion: PlaylistExpansion) => void;
    resolver.expandPlaylist.mockImplementationOnce(
      () =>
        new Promise<PlaylistExpansion>((resolve) => {
          resolveExpansion = resolve;
        }),
    );

    const pending = service.enqueuePlaylist(
      { id: "PL-cancelled", type: "playlist" },
      "user-1",
    );
    service.stop();
    resolveExpansion({
      tracks: [
        {
          id: "late",
          title: "Late track",
          webpageUrl: "https://www.youtube.com/watch?v=late",
        },
      ],
      total: 1,
    });

    await expect(pending).resolves.toEqual({ added: [], remaining: 1 });
    expect(service.queue()).toHaveLength(0);
  });

  it("truncates a playlist beyond the configured limit", async () => {
    const { resolver, service } = setup({ maxTracksPerUser: 200 });
    resolver.expandPlaylist.mockResolvedValueOnce({
      total: 105,
      tracks: Array.from({ length: 105 }, (_, index) => ({
        id: `p${index + 1}`,
        title: `Playlist Track ${index + 1}`,
        webpageUrl: `https://www.youtube.com/watch?v=p${index + 1}`,
      })),
    });

    const result = await service.enqueuePlaylist(
      { id: "PL2", type: "playlist" },
      "user-1",
    );

    expect(result.added).toHaveLength(100);
    expect(result.remaining).toBe(5);
  });

  it("enqueues exactly 100 playlist tracks when the limit is met", async () => {
    const { resolver, service } = setup({ maxTracksPerUser: 200 });
    resolver.expandPlaylist.mockResolvedValueOnce({
      total: 100,
      tracks: Array.from({ length: 100 }, (_, index) => ({
        id: `p${index + 1}`,
        title: `Playlist Track ${index + 1}`,
        webpageUrl: `https://www.youtube.com/watch?v=p${index + 1}`,
      })),
    });

    const result = await service.enqueuePlaylist(
      { id: "PL100", type: "playlist" },
      "user-1",
    );

    expect(result.added).toHaveLength(100);
    expect(result.remaining).toBe(0);
    expect(service.queue()).toHaveLength(99);
  });

  it("truncates a playlist of 101 tracks to 100 with remaining 1", async () => {
    const { resolver, service } = setup({ maxTracksPerUser: 200 });
    resolver.expandPlaylist.mockResolvedValueOnce({
      total: 101,
      tracks: Array.from({ length: 101 }, (_, index) => ({
        id: `p${index + 1}`,
        title: `Playlist Track ${index + 1}`,
        webpageUrl: `https://www.youtube.com/watch?v=p${index + 1}`,
      })),
    });

    const result = await service.enqueuePlaylist(
      { id: "PL101", type: "playlist" },
      "user-1",
    );

    expect(result.added).toHaveLength(100);
    expect(result.remaining).toBe(1);
    expect(service.queue()).toHaveLength(99);
  });

  it("skips duplicate tracks while expanding a playlist", async () => {
    const { resolver, service } = setup();
    resolver.expandPlaylist.mockResolvedValueOnce({
      total: 3,
      tracks: [
        {
          id: "dup",
          title: "Duplicate Track",
          webpageUrl: "https://www.youtube.com/watch?v=dup",
        },
        {
          id: "dup",
          title: "Duplicate Track",
          webpageUrl: "https://www.youtube.com/watch?v=dup",
        },
        {
          id: "fresh",
          title: "Fresh Track",
          webpageUrl: "https://www.youtube.com/watch?v=fresh",
        },
      ],
    });

    const result = await service.enqueuePlaylist(
      { id: "PL3", type: "playlist" },
      "user-1",
    );

    expect(result.added.map((track) => track.id)).toEqual(["dup", "fresh"]);
    expect(result.remaining).toBe(0);
    expect(service.queue()).toHaveLength(1);
  });

  it("rejects expanding a video resource as a playlist", async () => {
    const { service } = setup();

    await expect(
      service.enqueuePlaylist({ id: "v1", type: "video" }, "user-1"),
    ).rejects.toThrow(
      "Solo se pueden expandir playlists de YouTube con !play.",
    );
  });

  it("restores volume and loop mode from the state store", () => {
    const { service, stateStore } = setup({ stateStore: true });

    expect(service.volume).toBe(30);
    expect(service.loopMode).toBe("track");
    expect(stateStore!.load).toHaveBeenCalled();
  });

  it("persists volume and loop changes to the state store", () => {
    const { service, stateStore } = setup({ stateStore: true });

    service.setVolume(55);
    service.setLoopMode("queue");

    expect(stateStore!.save).toHaveBeenCalledWith({
      loopMode: "queue",
      queue: [],
      volumePercent: 55,
    });
  });

  it("persists the loop reset when the queue is cleared or playback stops", () => {
    const { service, stateStore } = setup({ stateStore: true });

    service.setLoopMode("queue");
    service.clearQueued();
    expect(stateStore!.save).toHaveBeenLastCalledWith({
      loopMode: "off",
      queue: [],
      volumePercent: 30,
    });

    service.setLoopMode("track");
    service.stop();
    expect(stateStore!.save).toHaveBeenLastCalledWith({
      loopMode: "off",
      queue: [],
      volumePercent: 30,
    });
  });

  it("suppresses persistence during graceful shutdown stop", () => {
    const { service, stateStore } = setup({ stateStore: true });

    service.stop(false);

    expect(stateStore!.save).not.toHaveBeenCalled();
  });

  it("persists the queue with the current track at the head", async () => {
    const { service, stateStore } = setup({ stateStore: true });

    await service.enqueue("https://youtu.be/a", "user-1");
    await service.enqueue("https://youtu.be/b", "user-1");
    await new Promise((resolve) => setImmediate(resolve));

    expect(stateStore!.save).toHaveBeenLastCalledWith({
      loopMode: "track",
      queue: [
        {
          id: "a",
          requestedBy: "user-1",
          source: "https://www.youtube.com/watch?v=a",
          title: "Track a",
        },
        {
          id: "b",
          requestedBy: "user-1",
          source: "https://www.youtube.com/watch?v=b",
          title: "Track b",
        },
      ],
      volumePercent: 30,
    });
  });

  it("restores queued tracks only for users still connected", async () => {
    const { createPlayback, service } = setup({
      restoredState: {
        queue: [
          {
            id: "a",
            requestedBy: "user-1",
            requestedByUid: "uid-1",
            source: "https://www.youtube.com/watch?v=a",
            title: "Track a",
          },
          {
            id: "b",
            requestedBy: "user-2",
            requestedByUid: "uid-2",
            source: "https://www.youtube.com/watch?v=b",
            title: "Track b",
          },
        ],
      },
      stateStore: true,
    });

    expect(service.restoreQueuedTracks(["uid-2", "bot-uid"])).toBe(1);
    expect(service.current?.id).toBe("b");
    expect(service.queue()).toHaveLength(0);

    await new Promise((resolve) => setImmediate(resolve));
    expect(createPlayback).toHaveBeenCalled();
  });

  it("clears the persisted queue when nobody is connected", () => {
    const { createPlayback, service } = setup({
      restoredState: {
        queue: [
          {
            id: "a",
            requestedBy: "user-1",
            requestedByUid: "uid-1",
            source: "https://www.youtube.com/watch?v=a",
            title: "Track a",
          },
        ],
      },
      stateStore: true,
    });

    expect(service.restoreQueuedTracks(["bot-uid"])).toBe(0);
    expect(service.queue()).toHaveLength(0);
    expect(createPlayback).not.toHaveBeenCalled();
  });

  it("restores at most maxQueueTracks entries", () => {
    const { service } = setup({
      maxQueueTracks: 2,
      restoredState: {
        queue: [
          {
            id: "a",
            requestedBy: "user-1",
            requestedByUid: "uid-1",
            source: "https://www.youtube.com/watch?v=a",
            title: "Track a",
          },
          {
            id: "b",
            requestedBy: "user-1",
            requestedByUid: "uid-1",
            source: "https://www.youtube.com/watch?v=b",
            title: "Track b",
          },
          {
            id: "c",
            requestedBy: "user-1",
            requestedByUid: "uid-1",
            source: "https://www.youtube.com/watch?v=c",
            title: "Track c",
          },
        ],
      },
      stateStore: true,
    });

    expect(service.restoreQueuedTracks(["uid-1"])).toBe(2);
    expect(service.current?.id).toBe("a");
    expect(service.queue()).toHaveLength(1);
  });

  it("drops persisted entries without requestedByUid", () => {
    const { service } = setup({
      restoredState: {
        queue: [
          {
            id: "a",
            requestedBy: "user-1",
            source: "https://www.youtube.com/watch?v=a",
            title: "Track a",
          },
          {
            id: "b",
            requestedBy: "user-1",
            requestedByUid: "uid-1",
            source: "https://www.youtube.com/watch?v=b",
            title: "Track b",
          },
        ],
      },
      stateStore: true,
    });

    expect(service.restoreQueuedTracks(["uid-1"])).toBe(1);
    expect(service.current?.id).toBe("b");
    expect(service.queue()).toHaveLength(0);
  });

  it("restores duration when present in the persisted entry", () => {
    const { service } = setup({
      restoredState: {
        queue: [
          {
            durationSeconds: 42,
            id: "a",
            requestedBy: "user-1",
            requestedByUid: "uid-1",
            source: "https://www.youtube.com/watch?v=a",
            title: "Track a",
          },
        ],
      },
      stateStore: true,
    });

    expect(service.restoreQueuedTracks(["uid-1"])).toBe(1);
    expect(service.current?.durationSeconds).toBe(42);
  });

  it("counts every track that actually starts playing", async () => {
    const { playbackResolvers, service } = setup();

    await service.enqueue("https://youtu.be/a", "user-1");
    await service.enqueue("https://youtu.be/b", "user-1");
    await new Promise((resolve) => setImmediate(resolve));
    expect(service.tracksPlayed).toBe(1);

    playbackResolvers[0]?.();
    await new Promise((resolve) => setImmediate(resolve));
    expect(service.tracksPlayed).toBe(2);
    expect(service.current?.id).toBe("b");

    playbackResolvers[1]?.();
    await new Promise((resolve) => setImmediate(resolve));
    expect(service.current).toBeUndefined();
  });

  it("promotes playnext ahead of the pending queue", async () => {
    const { service } = setup();

    await service.enqueue("https://youtu.be/a", "user-1");
    await service.enqueue("https://youtu.be/b", "user-1");
    const promoted = await service.enqueueNext("https://youtu.be/c", "user-2");

    expect(promoted.id).toBe("c");
    expect(service.queue().map((track) => track.id)).toEqual(["c", "b"]);
  });

  it("moves and removes ranges from the pending queue", async () => {
    const { service } = setup();

    await service.enqueue("https://youtu.be/a", "user-1");
    await service.enqueue("https://youtu.be/b", "user-1");
    await service.enqueue("https://youtu.be/c", "user-1");
    await service.enqueue("https://youtu.be/d", "user-1");

    expect(service.moveQueued(3, 1)?.id).toBe("d");
    expect(service.queue().map((track) => track.id)).toEqual(["d", "b", "c"]);
    expect(service.removeQueuedRange(2, 3).map((track) => track.id)).toEqual([
      "b",
      "c",
    ]);
    expect(service.queue().map((track) => track.id)).toEqual(["d"]);
  });

  it("records most recently started tracks in history order", async () => {
    const { playbackResolvers, service } = setup();

    await service.enqueue("https://youtu.be/a", "alice");
    await service.enqueue("https://youtu.be/b", "bob");
    await new Promise((resolve) => setImmediate(resolve));
    playbackResolvers[0]?.();
    await new Promise((resolve) => setImmediate(resolve));

    expect(service.history().map((track) => track.id)).toEqual(["b", "a"]);
    expect(service.history()[0]?.requestedBy).toBe("bob");
  });

  it("rejects enqueues beyond the total queue cap", async () => {
    const { service } = setup({ maxQueueTracks: 1 });

    await service.enqueue("https://youtu.be/a", "user-1");
    await service.enqueue("https://youtu.be/b", "user-1");

    await expect(
      service.enqueue("https://youtu.be/c", "user-1"),
    ).rejects.toThrow("La cola está llena");
  });

  it("rejects enqueues beyond the per-user cap", async () => {
    const { service } = setup({ maxTracksPerUser: 1 });

    await service.enqueue("https://youtu.be/a", "user-1");
    await service.enqueue("https://youtu.be/b", "user-1");

    await expect(
      service.enqueue("https://youtu.be/c", "user-1"),
    ).rejects.toThrow("Límite de 1 pistas por usuario");
    await expect(
      service.enqueue("https://youtu.be/x", "user-2"),
    ).resolves.toMatchObject({ id: "x" });
  });

  it("halts a playlist expansion when the queue cap is hit", async () => {
    const { resolver, service } = setup({ maxQueueTracks: 1 });
    resolver.expandPlaylist.mockResolvedValueOnce({
      total: 5,
      tracks: Array.from({ length: 5 }, (_, index) => ({
        id: `p${index + 1}`,
        title: `Playlist Track ${index + 1}`,
        webpageUrl: `https://www.youtube.com/watch?v=p${index + 1}`,
      })),
    });

    const result = await service.enqueuePlaylist(
      { id: "PL3", type: "playlist" },
      "user-1",
    );

    expect(result.added).toHaveLength(2);
    expect(result.remaining).toBe(3);
  });

  it("rejects concurrent playlist expansions", async () => {
    const { resolver, service } = setup();
    let releaseFirst!: () => void;
    resolver.expandPlaylist.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseFirst = () =>
          resolve({
            tracks: [
              {
                id: "p1",
                title: "Playlist Track",
                webpageUrl: "https://www.youtube.com/watch?v=p1",
              },
            ],
          });
      }),
    );

    const first = service.enqueuePlaylist(
      { id: "PL4", type: "playlist" },
      "user-1",
    );
    await expect(
      service.enqueuePlaylist({ id: "PL5", type: "playlist" }, "user-2"),
    ).rejects.toThrow("Ya hay una playlist");
    releaseFirst();
    await expect(first).resolves.toMatchObject({ added: [{ id: "p1" }] });
  });

  it("enqueues direct audio URLs through the direct URL resolver", async () => {
    const { directUrlResolverMocks, service } = setup({
      directUrlResolver: true,
    });

    const track = await service.enqueue(
      "https://cdn.example.test/audio.mp3",
      "user-1",
    );

    expect(directUrlResolverMocks.getTrack).toHaveBeenCalledWith(
      "https://cdn.example.test/audio.mp3",
    );
    expect(track).toMatchObject({
      requestedBy: "user-1",
      title: "Radio: ice1.somafm.com",
    });
  });

  it("rejects URLs the direct URL resolver does not match", async () => {
    const { directUrlResolverMocks, service } = setup({
      directUrlResolver: true,
    });
    directUrlResolverMocks.match.mockResolvedValue(false);

    await expect(
      service.enqueue("https://cdn.example.test/page.html", "user-1"),
    ).rejects.toThrow("No reconozco ese link");
  });

  it("plays direct URLs without calling yt-dlp", async () => {
    const { createPlayback, directUrlResolverMocks, resolver, service } = setup(
      { directUrlResolver: true },
    );

    await service.enqueue("https://cdn.example.test/audio.mp3", "user-1");
    await new Promise((resolve) => setImmediate(resolve));

    expect(resolver.getAudioUrlFromUrl).not.toHaveBeenCalled();
    expect(directUrlResolverMocks.getAudioUrl).toHaveBeenCalledWith(
      "https://ice1.somafm.com/groovesalad-128-mp3",
    );
    expect(createPlayback).toHaveBeenCalled();
  });

  it("reuses a persisted audio URL without calling yt-dlp", async () => {
    const cache = AudioUrlCache.memoryOnly();
    cache.set(
      "https://www.youtube.com/watch?v=cached",
      "https://media.example/cached",
      Date.now() + 10 * 60_000,
    );
    const { resolver, service } = setup({ audioUrlCache: cache });
    resolver.getTrack.mockImplementation((resource: { id: string }) =>
      Promise.resolve({
        id: resource.id,
        title: `Track ${resource.id}`,
        webpageUrl: `https://www.youtube.com/watch?v=${resource.id}`,
      }),
    );

    await service.enqueue("https://youtu.be/cached", "user-1");
    await new Promise((resolve) => setImmediate(resolve));

    expect(resolver.getAudioUrlFromUrl).not.toHaveBeenCalled();
    expect(service.current?.id).toBe("cached");
  });

  it("rejects seek when nothing is playing", () => {
    const { service } = setup();

    expect(() => service.seek(30)).toThrow("No hay nada reproduciéndose");
  });

  it("seeks within the current track and keeps it at the head", async () => {
    const { createPlayback, playbackResolvers, resolver, service } = setup();
    resolver.getTrack.mockResolvedValueOnce({
      audioUrl: "https://media.example/audio",
      durationSeconds: 100,
      id: "a",
      title: "Track a",
      webpageUrl: "https://www.youtube.com/watch?v=a",
    });

    await service.enqueue("https://youtu.be/a", "user-1");
    await new Promise((resolve) => setImmediate(resolve));
    expect(createPlayback).toHaveBeenCalledTimes(1);

    service.seek(150);
    playbackResolvers[0]?.();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(createPlayback).toHaveBeenCalledTimes(2);
    expect(createPlayback).toHaveBeenLastCalledWith(
      "https://media.example/audio",
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        seekSeconds: 99,
        audioFilter: { name: "off", param: {} },
      }),
    );
    expect(service.current?.id).toBe("a");
    expect(service.queue()).toHaveLength(0);
  });

  it("seeks without a known duration passes the raw offset", async () => {
    const { createPlayback, playbackResolvers, service } = setup();

    await service.enqueue("https://youtu.be/a", "user-1");
    await new Promise((resolve) => setImmediate(resolve));

    service.seek(500);
    playbackResolvers[0]?.();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(createPlayback).toHaveBeenLastCalledWith(
      "https://media.example/a",
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        seekSeconds: 500,
        audioFilter: { name: "off", param: {} },
      }),
    );
  });

  it("restores a persisted filter from state", () => {
    const { service } = setup({
      stateStore: true,
      restoredState: {
        filter: "bassboost",
        loopMode: "off",
        volumePercent: 50,
        queue: [],
      },
    });
    expect(service.filter).toBe("bassboost");
  });

  it("applies the active filter when creating a playback session", async () => {
    const { createPlayback, service } = setup();
    service.setFilter("nightcore", { rate: 1.25 });
    await service.enqueue("https://youtu.be/a", "user-1");
    await new Promise((resolve) => setImmediate(resolve));
    expect(createPlayback).toHaveBeenLastCalledWith(
      "https://media.example/a",
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        audioFilter: { name: "nightcore", param: { rate: 1.25 } },
      }),
    );
  });

  it("persists only the filter name to the state store", () => {
    const { service, stateStore } = setup({ stateStore: true });
    service.setFilter("bassboost", { level: 4 });
    expect(stateStore!.save).toHaveBeenCalledWith(
      expect.objectContaining({ filter: "bassboost" }),
    );
  });

  it("omits the filter from state when set to off", () => {
    const { service, stateStore } = setup({ stateStore: true });
    service.setFilter("bassboost");
    service.setFilter("off");
    const lastSave = stateStore!.save.mock.calls.at(-1)?.[0];
    expect(lastSave?.filter).toBeUndefined();
  });

  it("restarts playback at the current position when the filter changes", async () => {
    const { createPlayback, playbackResolvers, service } = setup({
      framesSent: 5000,
    });

    await service.enqueue("https://youtu.be/a", "user-1");
    await new Promise((resolve) => setImmediate(resolve));
    service.setFilter("bassboost");
    playbackResolvers[0]?.();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(createPlayback).toHaveBeenCalledTimes(2);
    expect(createPlayback).toHaveBeenLastCalledWith(
      expect.stringContaining("media.example"),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        seekSeconds: 100,
        audioFilter: { name: "bassboost", param: {} },
      }),
    );
  });

  it("coalesces two rapid filter changes into a single restart", async () => {
    const { createPlayback, playbackResolvers, service } = setup();

    await service.enqueue("https://youtu.be/a", "user-1");
    await new Promise((resolve) => setImmediate(resolve));
    service.setFilter("bassboost");
    service.setFilter("nightcore");
    playbackResolvers[0]?.();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(createPlayback).toHaveBeenCalledTimes(2);
    expect(createPlayback).toHaveBeenLastCalledWith(
      expect.stringContaining("media.example"),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        audioFilter: { name: "nightcore", param: {} },
      }),
    );
  });

  it("reports filter-change as the playback end reason", async () => {
    const { onPlaybackFinished, playbackResolvers, service } = setup();
    await service.enqueue("https://youtu.be/a", "user-1");
    await new Promise((resolve) => setImmediate(resolve));

    service.setFilter("bassboost");
    playbackResolvers[0]?.();
    await new Promise((resolve) => setImmediate(resolve));

    expect(onPlaybackFinished.mock.calls[0]?.[2]).toBe("filter-change");
  });

  it("replays the previous track at the front while playing", async () => {
    const { createPlayback, playbackResolvers, service } = setup();

    await service.enqueue("https://youtu.be/a", "user-1");
    await new Promise((resolve) => setImmediate(resolve));
    playbackResolvers[0]?.();
    await new Promise((resolve) => setImmediate(resolve));
    await service.enqueue("https://youtu.be/b", "user-1");
    await new Promise((resolve) => setImmediate(resolve));

    const replayed = service.replayPrevious();

    expect(replayed.id).toBe("a");
    expect(service.queue()[0]?.id).toBe("a");
    expect(createPlayback).toHaveBeenCalledTimes(2);
  });

  it("replays the last finished track when idle", async () => {
    const { createPlayback, playbackResolvers, service } = setup();

    await service.enqueue("https://youtu.be/a", "user-1");
    await new Promise((resolve) => setImmediate(resolve));
    playbackResolvers[0]?.();
    await new Promise((resolve) => setImmediate(resolve));
    service.stop();
    playbackResolvers[0]?.();
    await new Promise((resolve) => setImmediate(resolve));

    const replayed = service.replayPrevious();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(replayed.id).toBe("a");
    expect(service.current?.id).toBe("a");
    expect(createPlayback).toHaveBeenCalledTimes(2);
  });

  it("rejects replay when there is no history", () => {
    const { service } = setup();

    expect(() => service.replayPrevious()).toThrow(
      "No hay ninguna canción anterior",
    );
  });
});
