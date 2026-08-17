import { describe, expect, it } from "vitest";

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
});
