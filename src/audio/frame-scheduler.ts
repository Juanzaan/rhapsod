import { FRAME_DURATION_MS } from "./opus-encoder.js";

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

  constructor(options: FrameSchedulerOptions = {}) {
    this.#now = options.now ?? (() => performance.now());
    this.#schedule = options.schedule ?? setTimeout;
    this.#cancel = options.cancel ?? clearTimeout;
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
      onFrame();

      const now = this.#now();
      this.#nextFrameAt += FRAME_DURATION_MS;
      if (this.#nextFrameAt <= now) {
        const missedFrames = Math.floor(
          (now - this.#nextFrameAt) / FRAME_DURATION_MS,
        );
        this.#nextFrameAt += (missedFrames + 1) * FRAME_DURATION_MS;
      }
      this.#scheduleNext(onFrame);
    }, delay);
  }
}
