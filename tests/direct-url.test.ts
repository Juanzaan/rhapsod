import { describe, expect, it, vi } from "vitest";

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
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
const fetchResponse = (contentType: string | undefined, ok = true) =>
  ({
    headers: { get: () => contentType },
    ok,
  }) as unknown as Response;

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
      "https://[::1]/song.mp3",
      "https://localhost/song.mp3",
    ]) {
      await expect(resolver.match(url)).resolves.toBe(false);
    }
  });

  it("accepts extensionless URLs whose HEAD response is audio", async () => {
    audioFetch.mockResolvedValueOnce(fetchResponse("audio/mpeg"));
    const resolver = new DirectUrlClient({ fetch: audioFetch });

    await expect(
      resolver.match("https://ice1.somafm.com/groovesalad-128-mp3"),
    ).resolves.toBe(true);
  });

  it("rejects extensionless URLs whose HEAD response is not audio", async () => {
    audioFetch.mockResolvedValueOnce(fetchResponse("text/html"));
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
    mockProbe({});
    const resolver = new DirectUrlClient({ fetch: audioFetch });

    const track = await resolver.getTrack(
      "https://ice1.somafm.com/groovesalad-128-mp3",
    );

    expect(track.title).toBe("Radio: ice1.somafm.com");
    expect(track.durationSeconds).toBeUndefined();
  });

  it("uses the filename as the title when ffprobe has no tags", async () => {
    mockProbe({ duration: "12.4" });
    const resolver = new DirectUrlClient({ fetch: audioFetch });

    const track = await resolver.getTrack(
      "https://cdn.example.test/my-track.mp3",
    );

    expect(track.title).toBe("my track");
    expect(track.durationSeconds).toBe(12);
  });

  it("rejects when ffprobe fails", async () => {
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

  it("returns the URL unchanged as the playable audio", async () => {
    const resolver = new DirectUrlClient({ fetch: audioFetch });

    await expect(
      resolver.getAudioUrl("https://cdn.example.test/song.mp3"),
    ).resolves.toBe("https://cdn.example.test/song.mp3");
  });
});
