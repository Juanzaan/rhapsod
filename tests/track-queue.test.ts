import { describe, expect, it } from "vitest";

import type { Track } from "../src/domain/track.js";
import { QueueLimitError, TrackQueue } from "../src/application/track-queue.js";

function makeTrack(
  id: string,
  requestedBy: string,
  requestedByUid?: string,
): Track {
  return {
    id,
    requestedBy,
    ...(requestedByUid === undefined ? {} : { requestedByUid }),
    source: `https://example.com/${id}`,
    title: `Track ${id}`,
  };
}

describe("TrackQueue", () => {
  it("rejects new tracks once the queue is full", () => {
    const queue = new TrackQueue({ maxQueueTracks: 2 });
    queue.add(makeTrack("a", "ana", "uid-1"), undefined);
    queue.add(makeTrack("b", "beto", "uid-2"), undefined);

    expect(() =>
      queue.add(makeTrack("c", "carlos", "uid-3"), undefined),
    ).toThrowError(QueueLimitError);
    expect(() =>
      queue.add(makeTrack("c", "carlos", "uid-3"), undefined),
    ).toThrowError(/llena/);
    expect(queue.length).toBe(2);
  });

  it("caps tracks per user matched by uid", () => {
    const queue = new TrackQueue({ maxTracksPerUser: 1 });
    queue.add(makeTrack("a", "ana", "uid-1"), undefined);

    expect(() =>
      queue.add(makeTrack("b", "ana-renamed", "uid-1"), undefined),
    ).toThrowError(QueueLimitError);
    expect(() =>
      queue.add(makeTrack("b", "ana-renamed", "uid-1"), undefined),
    ).toThrowError(/por usuario/);
  });

  it("falls back to display name when uid is missing", () => {
    const queue = new TrackQueue({ maxTracksPerUser: 1 });
    queue.add(makeTrack("a", "ana"), undefined);

    expect(() => queue.add(makeTrack("b", "ana"), undefined)).toThrowError(
      QueueLimitError,
    );
    expect(() => queue.add(makeTrack("b", "beto"), undefined)).not.toThrow();
  });

  it("counts the current track against the requester quota", () => {
    const queue = new TrackQueue({ maxTracksPerUser: 1 });
    const current = makeTrack("now", "ana", "uid-1");

    expect(() =>
      queue.add(makeTrack("next", "ana", "uid-1"), current),
    ).toThrowError(QueueLimitError);
    expect(() =>
      queue.add(makeTrack("next", "beto", "uid-2"), current),
    ).not.toThrow();
  });

  it("keeps rejecting duplicate ids", () => {
    const queue = new TrackQueue();
    queue.add(makeTrack("a", "ana", "uid-1"), undefined);

    expect(() =>
      queue.add(makeTrack("a", "ana", "uid-1"), undefined),
    ).toThrowError(/ya está en la cola/);
  });

  it("requeue bypasses limits for internal re-adds", () => {
    const queue = new TrackQueue({ maxQueueTracks: 1, maxTracksPerUser: 1 });
    queue.add(makeTrack("a", "ana", "uid-1"), undefined);

    expect(() => queue.requeue(makeTrack("b", "ana", "uid-1"))).not.toThrow();
    expect(queue.length).toBe(2);
  });

  it("moves, removes and drains entries", () => {
    const queue = new TrackQueue();
    queue.add(makeTrack("a", "ana"), undefined);
    queue.add(makeTrack("b", "beto"), undefined);
    queue.add(makeTrack("c", "carlos"), undefined);

    expect(queue.move(3, 1)?.id).toBe("c");
    expect(queue.snapshot().map((track) => track.id)).toEqual(["c", "a", "b"]);
    expect(queue.removeAt(2)?.id).toBe("a");
    expect(queue.removeRange(1, 2).map((track) => track.id)).toEqual([
      "c",
      "b",
    ]);
    expect(queue.length).toBe(0);
    expect(queue.removeAt(1)).toBeUndefined();
  });

  it("clears, shuffles and exposes capacity", () => {
    const queue = new TrackQueue({ maxQueueTracks: 7 });
    expect(queue.maxTracks).toBe(7);
    queue.add(makeTrack("a", "ana"), undefined);
    queue.add(makeTrack("b", "beto"), undefined);

    queue.shuffle();
    expect(queue.snapshot()).toHaveLength(2);
    expect(queue.next()).toBeDefined();
    queue.clear();
    expect(queue.length).toBe(0);
    expect(queue.next()).toBeUndefined();
  });
});
