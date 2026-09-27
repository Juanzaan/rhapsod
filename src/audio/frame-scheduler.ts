import { FRAME_DURATION_MS } from "./opus-encoder.js";

/** Upper bounds, in ms, of the tick lateness buckets; one more bucket is open-ended. */
export const TICK_LATENESS_BOUNDS_MS = [1, 2, 5, 10, 20, 50] as const;

/** How late each tick fired against its absolute deadline. */
export interface ClockTiming {
  readonly ticks: number;
  /** Per-bucket counts, one per bound plus the open-ended bucket. */
  readonly latenessCounts: readonly number[];
  readonly latenessSumMs: number;
  readonly maxLatenessMs: number;
  /** Ticks more than a frame late, where the clock dropped its base. */
  readonly clockSlips: number;
}

interface FrameSchedulerOptions {
  readonly now?: () => number;
  readonly schedule?: (callback: () => void, delayMs: number) => NodeJS.Timeout;
  readonly cancel?: (timer: NodeJS.Timeout) => void;
}

export class FrameScheduler {
  readonly #now: () => number;
  readonly #schedule: (callback: () => void, delayMs: number) => NodeJS.Timeout;
  readonly #cancel: (timer: NodeJS.Timeout) => void;
  #nextFrameAt = 0;
  #running = false;
  #timer: NodeJS.Timeout | undefined;
  #ticks = 0;
  readonly #latenessCounts = TICK_LATENESS_BOUNDS_MS.map(() => 0).concat(0);
  #latenessSumMs = 0;
  #maxLatenessMs = 0;
  #clockSlips = 0;

  constructor(options: FrameSchedulerOptions = {}) {
    this.#now = options.now ?? (() => performance.now());
    this.#schedule = options.schedule ?? setTimeout;
    this.#cancel = options.cancel ?? clearTimeout;
  }

  get timing(): ClockTiming {
    return {
      clockSlips: this.#clockSlips,
      latenessCounts: [...this.#latenessCounts],
      latenessSumMs: this.#latenessSumMs,
      maxLatenessMs: this.#maxLatenessMs,
      ticks: this.#ticks,
    };
  }

  start(onFrame: () => void): void {
    if (this.#running) return;
    this.#running = true;
    this.#nextFrameAt = this.#now() + FRAME_DURATION_MS;
    this.#scheduleNext(onFrame);
  }

  stop(): void {
    this.#running = false;
    if (this.#timer !== undefined) this.#cancel(this.#timer);
    this.#timer = undefined;
  }

  #scheduleNext(onFrame: () => void): void {
    if (!this.#running) return;
    const delay = Math.max(0, this.#nextFrameAt - this.#now());
    this.#timer = this.#schedule(() => {
      if (!this.#running) return;
      const now = this.#now();
      const lateness = Math.max(0, now - this.#nextFrameAt);
      this.#recordLateness(lateness);
      if (lateness > FRAME_DURATION_MS) {
        this.#clockSlips++;
        this.#nextFrameAt = now;
      }
      onFrame();
      this.#nextFrameAt += FRAME_DURATION_MS;
      this.#scheduleNext(onFrame);
    }, delay);
  }

  #recordLateness(latenessMs: number): void {
    this.#ticks++;
    this.#latenessSumMs += latenessMs;
    this.#maxLatenessMs = Math.max(this.#maxLatenessMs, latenessMs);
    const bucket = TICK_LATENESS_BOUNDS_MS.findIndex(
      (bound) => latenessMs <= bound,
    );
    this.#latenessCounts[
      bucket === -1 ? TICK_LATENESS_BOUNDS_MS.length : bucket
    ]!++;
  }
}
