import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.hoisted(() => vi.fn());
const lookupMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

vi.mock("node:dns/promises", () => ({
  lookup: lookupMock,
}));

import { DirectUrlClient } from "../src/media/direct-url.js";

function mockProbe(
  format: { duration?: string; tags?: Record<string, string> } | undefined,
): void {
  execFileMock.mockImplementation(
    (
      _binary: string,
      _args: string[],
      _options: unknown,
      callback: (error: Error | null, result: { stdout: string }) => void,
    ) => {
      callback(null, {
        stdout: JSON.stringify(format === undefined ? {} : { format }),
      });
    },
  );
}

const audioFetch = vi.fn();
const fetchResponse = (
  options: { contentType?: string; location?: string; status?: number } = {},
) =>
  ({
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "location"
          ? (options.location ?? null)
          : (options.contentType ?? null),
    },
    ok: (options.status ?? 200) >= 200 && (options.status ?? 200) < 300,
    status: options.status ?? 200,
  }) as unknown as Response;

beforeEach(() => {
  audioFetch.mockReset();
  lookupMock.mockReset();
  lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
});

describe("DirectUrlResolver", () => {
  it("matches URLs with a known audio extension", async () => {
    const resolver = new DirectUrlClient({ fetch: audioFetch });

    for (const url of [
      "https://cdn.example.test/song.mp3",
      "https://cdn.example.test/song.ogg",
      "https://cdn.example.test/SONG.M4A",
      "https://cdn.example.test/stream.m3u8",
    ]) {
      await expect(resolver.match(url)).resolves.toBe(true);
    }
    expect(audioFetch).not.toHaveBeenCalled();
  });

  it("rejects URLs with a non-audio extension", async () => {
    const resolver = new DirectUrlClient({ fetch: audioFetch });

    await expect(
      resolver.match("https://cdn.example.test/page.html"),
    ).resolves.toBe(false);
    await expect(
      resolver.match("https://cdn.example.test/song.php"),
    ).resolves.toBe(false);
  });

  it("rejects non-HTTP schemes", async () => {
    const resolver = new DirectUrlClient({ fetch: audioFetch });

    await expect(resolver.match("file:///tmp/song.mp3")).resolves.toBe(false);
  });

  it("rejects insecure HTTP URLs even with an audio extension", async () => {
    const resolver = new DirectUrlClient({ fetch: audioFetch });

    await expect(
      resolver.match("http://cdn.example.test/song.mp3"),
    ).resolves.toBe(false);
  });

  it("rejects URLs pointing at private hosts", async () => {
    const resolver = new DirectUrlClient({ fetch: audioFetch });

    for (const url of [
      "https://127.0.0.1/song.mp3",
      "https://10.0.0.5/song.mp3",
      "https://192.168.1.10/song.mp3",
      "https://169.254.169.254/song.mp3",
      "https://100.80.92.115/song.mp3",
      "https://[::1]/song.mp3",
      "https://[::ffff:7f00:1]/song.mp3",
      "https://[::ffff:127.0.0.1]/song.mp3",
      "https://localhost/song.mp3",
    ]) {
      await expect(resolver.match(url)).resolves.toBe(false);
    }
  });

  it("rejects URLs whose hostname resolves to a private address", async () => {
    lookupMock.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ]);
    const resolver = new DirectUrlClient({ fetch: audioFetch });

    await expect(
      resolver.match("https://cdn.example.test/song.mp3"),
    ).resolves.toBe(false);
  });

  it("rejects URLs whose hostname cannot be resolved", async () => {
    lookupMock.mockRejectedValue(new Error("ENOTFOUND"));
    const resolver = new DirectUrlClient({ fetch: audioFetch });

    await expect(
      resolver.match("https://cdn.example.test/song.mp3"),
    ).resolves.toBe(false);
  });

  it("accepts extensionless URLs whose HEAD response is audio", async () => {
    audioFetch.mockResolvedValueOnce(
      fetchResponse({ contentType: "audio/mpeg" }),
    );
    const resolver = new DirectUrlClient({ fetch: audioFetch });

    await expect(
      resolver.match("https://ice1.somafm.com/groovesalad-128-mp3"),
    ).resolves.toBe(true);
  });

  it("caches match results so repeated checks skip the HEAD request", async () => {
    audioFetch.mockResolvedValueOnce(
      fetchResponse({ contentType: "audio/mpeg" }),
    );
    const resolver = new DirectUrlClient({ fetch: audioFetch });

    await resolver.match("https://ice1.somafm.com/groovesalad-128-mp3");
    await resolver.match("https://ice1.somafm.com/groovesalad-128-mp3");
    await resolver.match("https://ice1.somafm.com/groovesalad-128-mp3");

    expect(audioFetch).toHaveBeenCalledTimes(1);
  });

  it("rejects extensionless URLs whose HEAD response is not audio", async () => {
    audioFetch.mockResolvedValueOnce(
      fetchResponse({ contentType: "text/html" }),
    );
    const resolver = new DirectUrlClient({ fetch: audioFetch });

    await expect(resolver.match("https://example.test/feed")).resolves.toBe(
      false,
    );
  });

  it("rejects extensionless URLs whose HEAD request fails", async () => {
    audioFetch.mockRejectedValueOnce(new Error("network down"));
    const resolver = new DirectUrlClient({ fetch: audioFetch });

    await expect(resolver.match("https://example.test/feed")).resolves.toBe(
      false,
    );
  });

  it("builds a track with tags title and artist from ffprobe", async () => {
    audioFetch.mockResolvedValueOnce(
      fetchResponse({ contentType: "audio/mpeg" }),
    );
    mockProbe({
      duration: "214.5",
      tags: { artist: "Duki", title: "Rockstar" },
    });
    const resolver = new DirectUrlClient({ fetch: audioFetch });

    const track = await resolver.getTrack("https://cdn.example.test/song.mp3");

    expect(track).toMatchObject({
      durationSeconds: 215,
      title: "Duki - Rockstar",
      webpageUrl: "https://cdn.example.test/song.mp3",
    });
    expect(track.id).toHaveLength(12);
  });

  it("names a stream without duration as a radio station", async () => {
    audioFetch.mockResolvedValueOnce(
      fetchResponse({ contentType: "audio/mpeg" }),
    );
    mockProbe({});
    const resolver = new DirectUrlClient({ fetch: audioFetch });

    const track = await resolver.getTrack(
      "https://ice1.somafm.com/groovesalad-128-mp3",
    );

    expect(track.title).toBe("Radio: ice1.somafm.com");
    expect(track.durationSeconds).toBeUndefined();
  });

  it("uses the filename as the title when ffprobe has no tags", async () => {
    audioFetch.mockResolvedValueOnce(
      fetchResponse({ contentType: "audio/mpeg" }),
    );
    mockProbe({ duration: "12.4" });
    const resolver = new DirectUrlClient({ fetch: audioFetch });

    const track = await resolver.getTrack(
      "https://cdn.example.test/my-track.mp3",
    );

    expect(track.title).toBe("my track");
    expect(track.durationSeconds).toBe(12);
  });

  it("probes the validated final URL without following redirects", async () => {
    audioFetch
      .mockResolvedValueOnce(
        fetchResponse({
          status: 302,
          location: "https://cdn.example.test/real.mp3",
        }),
      )
      .mockResolvedValueOnce(fetchResponse({ contentType: "audio/mpeg" }));
    execFileMock.mockImplementation(
      (
        _binary: string,
        args: string[],
        _options: unknown,
        callback: (error: Error | null, result: { stdout: string }) => void,
      ) => {
        expect(args).toContain("-max_redirects");
        expect(args.at(-1)).toBe("https://cdn.example.test/real.mp3");
        callback(null, {
          stdout: JSON.stringify({ format: { duration: "12.4" } }),
        });
      },
    );
    const resolver = new DirectUrlClient({ fetch: audioFetch });

    const track = await resolver.getTrack(
      "https://evil.example.test/audio.mp3",
    );

    expect(track.durationSeconds).toBe(12);
  });

  it("rejects when ffprobe fails", async () => {
    audioFetch.mockResolvedValueOnce(
      fetchResponse({ contentType: "audio/mpeg" }),
    );
    execFileMock.mockImplementation(
      (
        _binary: string,
        _args: string[],
        _options: unknown,
        callback: (error: Error | null, result: { stdout: string }) => void,
      ) => {
        callback(new Error("ffprobe exited with code 1"), { stdout: "" });
      },
    );
    const resolver = new DirectUrlClient({ fetch: audioFetch });

    await expect(
      resolver.getTrack("https://cdn.example.test/song.mp3"),
    ).rejects.toThrow("ffprobe exited with code 1");
  });

  it("rejects URLs that redirect to a private host", async () => {
    audioFetch.mockResolvedValueOnce(
      fetchResponse({ status: 302, location: "https://169.254.169.254/x.mp3" }),
    );
    const resolver = new DirectUrlClient({ fetch: audioFetch });

    await expect(
      resolver.getTrack("https://evil.example.test/audio.mp3"),
    ).rejects.toThrow("No se pudo validar la URL de audio");
    expect(audioFetch).toHaveBeenCalledTimes(1);
  });

  it("rejects URLs that redirect to an insecure target", async () => {
    audioFetch.mockResolvedValueOnce(
      fetchResponse({
        status: 302,
        location: "http://cdn.example.test/real.mp3",
      }),
    );
    const resolver = new DirectUrlClient({ fetch: audioFetch });

    await expect(
      resolver.getTrack("https://evil.example.test/audio.mp3"),
    ).rejects.toThrow("No se pudo validar la URL de audio");
  });

  it("rejects URLs that redirect more than five times", async () => {
    audioFetch.mockResolvedValue(
      fetchResponse({
        status: 302,
        location: "https://evil.example.test/next.mp3",
      }),
    );
    const resolver = new DirectUrlClient({ fetch: audioFetch });

    await expect(
      resolver.getTrack("https://evil.example.test/audio.mp3"),
    ).rejects.toThrow("No se pudo validar la URL de audio");
    expect(audioFetch).toHaveBeenCalledTimes(6);
  });

  it("returns the URL unchanged as the playable audio", async () => {
    audioFetch.mockResolvedValueOnce(
      fetchResponse({ contentType: "audio/mpeg" }),
    );
    const resolver = new DirectUrlClient({ fetch: audioFetch });

    await expect(
      resolver.getAudioUrl("https://cdn.example.test/song.mp3"),
    ).resolves.toBe("https://cdn.example.test/song.mp3");
  });

  it("returns the validated final URL after redirects", async () => {
    audioFetch
      .mockResolvedValueOnce(
        fetchResponse({
          status: 302,
          location: "https://cdn.example.test/real.mp3",
        }),
      )
      .mockResolvedValueOnce(fetchResponse({ contentType: "audio/mpeg" }));
    const resolver = new DirectUrlClient({ fetch: audioFetch });

    await expect(
      resolver.getAudioUrl("https://cdn.example.test/audio.mp3"),
    ).resolves.toBe("https://cdn.example.test/real.mp3");
  });

  it("rejects the audio URL when the redirect chain targets a private host", async () => {
    audioFetch.mockResolvedValueOnce(
      fetchResponse({ status: 302, location: "https://10.0.0.5/x.mp3" }),
    );
    const resolver = new DirectUrlClient({ fetch: audioFetch });

    await expect(
      resolver.getAudioUrl("https://evil.example.test/audio.mp3"),
    ).rejects.toThrow("No se pudo validar la URL de audio");
  });
});
