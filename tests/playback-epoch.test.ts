import { describe, expect, it } from "vitest";

import { PlaybackEpoch } from "../src/application/playback-epoch.js";

describe("PlaybackEpoch", () => {
  it("starts current for freshly captured stamps", () => {
    const epochs = new PlaybackEpoch();
    const stamp = epochs.stamp();

    expect(epochs.isCurrent(stamp)).toBe(true);
    expect(epochs.isGenerationCurrent(stamp.generation)).toBe(true);
    expect(epochs.isStopEpochCurrent(stamp.stopEpoch)).toBe(true);
  });

  it("invalidatePlayback stales generations but spares background work", () => {
    // A skip must abandon the handoff without cancelling an in-flight
    // playlist expansion or a deferred prefetch batch.
    const epochs = new PlaybackEpoch();
    const before = epochs.stamp();

    epochs.invalidatePlayback();

    expect(epochs.isCurrent(before)).toBe(false);
    expect(epochs.isGenerationCurrent(before.generation)).toBe(false);
    expect(epochs.isStopEpochCurrent(before.stopEpoch)).toBe(true);
  });

  it("resetAll stales everything", () => {
    const epochs = new PlaybackEpoch();
    const before = epochs.stamp();

    epochs.resetAll();

    expect(epochs.isCurrent(before)).toBe(false);
    expect(epochs.isGenerationCurrent(before.generation)).toBe(false);
    expect(epochs.isStopEpochCurrent(before.stopEpoch)).toBe(false);
  });

  it("nextGeneration claims a fresh, current generation", () => {
    const epochs = new PlaybackEpoch();
    const stale = epochs.stamp();

    const claimed = epochs.nextGeneration();

    expect(epochs.isGenerationCurrent(claimed)).toBe(true);
    expect(epochs.isGenerationCurrent(stale.generation)).toBe(false);
    // A new driver iteration is not a stop: background work survives.
    expect(epochs.isStopEpochCurrent(stale.stopEpoch)).toBe(true);
  });

  it("tracks repeated invalidations independently per scope", () => {
    const epochs = new PlaybackEpoch();

    epochs.invalidatePlayback();
    epochs.invalidatePlayback();
    const mid = epochs.stamp();
    epochs.resetAll();

    expect(epochs.isGenerationCurrent(mid.generation)).toBe(false);
    expect(epochs.isStopEpochCurrent(mid.stopEpoch)).toBe(false);
    expect(epochs.isCurrent(epochs.stamp())).toBe(true);
  });
});
