/**
 * The playback service's staleness protocol, made explicit.
 *
 * Async work (playlist expansions, deferred prefetch batches, prewarm
 * scheduling, the driver loop itself) outlives the user action that started
 * it: a skip landing mid-expansion must not enqueue stale tracks, and a stop
 * must park everything. Two counters with deliberately different scopes:
 *
 * - generation: the current playback intent. Bumped by anything that changes
 *   what should play next (skip, seek, filter restart, stop, clear) and
 *   claimed fresh by each driver-loop iteration. Guards the handoff.
 * - stopEpoch: background-work lifetime. Bumped ONLY by stop/clear — a skip
 *   intentionally does NOT cancel an in-flight playlist expansion or a
 *   deferred prefetch batch (the queue still wants those tracks).
 *
 * Both start at 0; only relative change is meaningful, never the value.
 */
export interface EpochStamp {
  readonly generation: number;
  readonly stopEpoch: number;
}

export class PlaybackEpoch {
  #generation = 0;
  #stopEpoch = 0;

  /** Capture both counters for later staleness checks. */
  stamp(): EpochStamp {
    return { generation: this.#generation, stopEpoch: this.#stopEpoch };
  }

  /** Capture only the background-work counter. */
  captureStopEpoch(): number {
    return this.#stopEpoch;
  }

  /**
   * Playback intent changed: stale loop iterations and handoffs must yield.
   * Deferred background work (playlist expansion, prefetch batches) survives.
   */
  invalidatePlayback(): void {
    this.#generation++;
  }

  /**
   * Claim a fresh generation for a new driver-loop iteration and return it.
   */
  nextGeneration(): number {
    this.#generation++;
    return this.#generation;
  }

  /** Full stop: abandon playback intent AND all background work. */
  resetAll(): void {
    this.#generation++;
    this.#stopEpoch++;
  }

  isGenerationCurrent(generation: number): boolean {
    return generation === this.#generation;
  }

  isStopEpochCurrent(stopEpoch: number): boolean {
    return stopEpoch === this.#stopEpoch;
  }

  isCurrent(stamp: EpochStamp): boolean {
    return (
      stamp.generation === this.#generation &&
      stamp.stopEpoch === this.#stopEpoch
    );
  }
}
