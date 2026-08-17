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

  it("rejects empty and malformed provider inputs", () => {
    expect(() => parseMediaInput(" ")).toThrow("cannot be empty");
    expect(() =>
      parseMediaInput("https://open.spotify.com/track/not-valid!"),
    ).toThrow("Invalid Spotify resource identifier");
  });
});
