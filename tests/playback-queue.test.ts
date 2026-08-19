import { afterEach, describe, expect, it, vi } from "vitest";

import { PlaybackQueue } from "../src/domain/playback-queue.js";
import type { Track } from "../src/domain/track.js";

const firstTrack: Track = {
  id: "track-1",
  requestedBy: "alice",
  source: "https://example.com/first",
  title: "First track",
};

const secondTrack: Track = {
  id: "track-2",
  requestedBy: "bob",
  source: "https://example.com/second",
  title: "Second track",
};

describe("PlaybackQueue", () => {
  it("returns tracks in insertion order", () => {
    const queue = new PlaybackQueue();
    queue.add(firstTrack);
    queue.add(secondTrack);
    expect(queue.next()).toEqual(firstTrack);
    expect(queue.next()).toEqual(secondTrack);
    expect(queue.next()).toBeUndefined();
  });

  it("rejects duplicate track identifiers", () => {
    const queue = new PlaybackQueue();
    queue.add(firstTrack);
    expect(() => queue.add(firstTrack)).toThrow(
      "Track track-1 is already queued",
    );
  });

  it("returns an isolated snapshot", () => {
    const queue = new PlaybackQueue();
    queue.add(firstTrack);
    const snapshot = queue.snapshot();
    queue.clear();
    expect(snapshot).toEqual([firstTrack]);
    expect(queue.length).toBe(0);
  });

  it("shuffles the pending tracks without dropping any", () => {
    const random = vi.spyOn(Math, "random");
    random
      .mockReturnValueOnce(0.99)
      .mockReturnValueOnce(0.0)
      .mockReturnValueOnce(0.5);
    const queue = new PlaybackQueue();
    queue.add(firstTrack);
    queue.add(secondTrack);
    queue.add({
      id: "track-3",
      requestedBy: "carol",
      source: "https://example.com/third",
      title: "Third track",
    });

    queue.shuffle();

    const shuffled = queue.snapshot();
    expect(shuffled).toHaveLength(3);
    expect(new Set(shuffled.map((track) => track.id))).toEqual(
      new Set(["track-1", "track-2", "track-3"]),
    );
    random.mockRestore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
