import { describe, expect, it } from "vitest";

import { parseMediaInput } from "../src/media/media-input.js";

describe("parseMediaInput", () => {
  it("classifies YouTube watch and short links", () => {
    expect(parseMediaInput("https://www.youtube.com/watch?v=abc_123")).toEqual({
      kind: "youtube",
      resource: { id: "abc_123", type: "video" },
    });
    expect(parseMediaInput("https://youtu.be/short-id?t=10")).toEqual({
      kind: "youtube",
      resource: { id: "short-id", type: "video" },
    });
  });

  it("preserves YouTube playlist context", () => {
    expect(
      parseMediaInput("https://youtube.com/playlist?list=PL_test-123"),
    ).toEqual({
      kind: "youtube",
      resource: { id: "PL_test-123", type: "playlist" },
    });
    expect(
      parseMediaInput("https://youtube.com/watch?v=video1&list=PL_test-123"),
    ).toEqual({
      kind: "youtube",
      resource: { id: "video1", playlistId: "PL_test-123", type: "video" },
    });
  });

  it("classifies YouTube Music links like regular YouTube", () => {
    expect(
      parseMediaInput("https://music.youtube.com/watch?v=abc_123"),
    ).toEqual({
      kind: "youtube",
      resource: { id: "abc_123", type: "video" },
    });
    expect(
      parseMediaInput("https://music.youtube.com/playlist?list=PL_test-123"),
    ).toEqual({
      kind: "youtube",
      resource: { id: "PL_test-123", type: "playlist" },
    });
  });

  it("classifies Spotify resources without treating them as audio URLs", () => {
    expect(
      parseMediaInput(
        "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=x",
      ),
    ).toEqual({
      kind: "spotify",
      resource: { id: "4uLU6hMCjMI75M1A2tKUQC", type: "track" },
    });
    expect(
      parseMediaInput(
        "https://open.spotify.com/intl-es/album/1ATL5GLyefJaxhQzSPVrLX",
      ),
    ).toEqual({
      kind: "spotify",
      resource: { id: "1ATL5GLyefJaxhQzSPVrLX", type: "album" },
    });
  });

  it("classifies SoundCloud track links", () => {
    expect(
      parseMediaInput("https://soundcloud.com/artist-name/track-name?si=test"),
    ).toEqual({
      kind: "soundcloud",
      value: "https://soundcloud.com/artist-name/track-name?si=test",
    });
    expect(
      parseMediaInput("https://soundcloud.com/artist-name/sets/playlist-name"),
    ).toEqual({
      kind: "soundcloud",
      value: "https://soundcloud.com/artist-name/sets/playlist-name",
    });
    expect(
      parseMediaInput("https://on.soundcloud.com/0Tbj4O1F7XxfV6DDjQ"),
    ).toEqual({
      kind: "soundcloud",
      value: "https://on.soundcloud.com/0Tbj4O1F7XxfV6DDjQ",
    });
  });

  it("supports explicit local files and direct media URLs", () => {
    expect(parseMediaInput("file: ./music/song.mp3")).toEqual({
      kind: "file",
      value: "./music/song.mp3",
    });
    expect(parseMediaInput("https://cdn.example.test/song.mp3")).toEqual({
      kind: "url",
      value: "https://cdn.example.test/song.mp3",
    });
  });

  it("classifies Apple Music and Amazon Music links", () => {
    expect(
      parseMediaInput(
        "https://music.apple.com/us/album/titulo/123456789?i=987654321",
      ),
    ).toEqual({
      kind: "apple-music",
      value: "https://music.apple.com/us/album/titulo/123456789?i=987654321",
    });
    expect(
      parseMediaInput("https://itunes.apple.com/ar/album/titulo/123456789"),
    ).toEqual({
      kind: "apple-music",
      value: "https://itunes.apple.com/ar/album/titulo/123456789",
    });
    expect(
      parseMediaInput(
        "https://music.amazon.com/albums/B0ABC123?trackAsin=B0XYZ",
      ),
    ).toEqual({
      kind: "amazon-music",
      value: "https://music.amazon.com/albums/B0ABC123?trackAsin=B0XYZ",
    });
    expect(parseMediaInput("https://music.amazon.com.mx/tracks/B0XYZ")).toEqual(
      {
        kind: "amazon-music",
        value: "https://music.amazon.com.mx/tracks/B0XYZ",
      },
    );
  });

  it("rejects empty and malformed provider inputs", () => {
    expect(() => parseMediaInput(" ")).toThrow("cannot be empty");
    expect(() =>
      parseMediaInput("https://open.spotify.com/track/not-valid!"),
    ).toThrow("Invalid Spotify resource identifier");
  });
});
