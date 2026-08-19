import { FRAME_DURATION_MS } from "./opus-encoder.js";

const MAX_CATCH_UP_FRAMES = 25;

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
      const now = this.#now();
      const missedFrames = Math.max(
        0,
        Math.floor((now - this.#nextFrameAt) / FRAME_DURATION_MS),
      );
      const framesToSend = Math.min(missedFrames + 1, MAX_CATCH_UP_FRAMES);
      for (let i = 0; i < framesToSend; i++) onFrame();
      this.#nextFrameAt += (missedFrames + 1) * FRAME_DURATION_MS;
      if (this.#nextFrameAt <= now) {
        this.#nextFrameAt = now + FRAME_DURATION_MS;
      }
      this.#scheduleNext(onFrame);
    }, delay);
  }
}
