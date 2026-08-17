import { describe, expect, it, vi } from "vitest";

import { FrameScheduler } from "../src/audio/frame-scheduler.js";

describe("FrameScheduler", () => {
  it("schedules against absolute frame deadlines", () => {
    let now = 1_000;
    const callbacks: Array<() => void> = [];
    const delays: number[] = [];
    const scheduler = new FrameScheduler({
      now: () => now,
      schedule: (callback, delay) => {
        callbacks.push(callback);
        delays.push(delay);
        return {} as NodeJS.Timeout;
      },
    });
    const onFrame = vi.fn();

    scheduler.start(onFrame);
    expect(delays).toEqual([20]);

    now = 1_025;
    callbacks.shift()?.();
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([20, 15]);
  });

  it("skips missed deadlines instead of emitting a burst", () => {
    let now = 0;
    const callbacks: Array<() => void> = [];
    const delays: number[] = [];
    const scheduler = new FrameScheduler({
      now: () => now,
      schedule: (callback, delay) => {
        callbacks.push(callback);
        delays.push(delay);
        return {} as NodeJS.Timeout;
      },
    });
    const onFrame = vi.fn();

    scheduler.start(onFrame);
    now = 95;
    callbacks.shift()?.();

    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(delays.at(-1)).toBe(5);
    expect(callbacks).toHaveLength(1);
  });

  it("cancels a pending frame when stopped", () => {
    const timer = {} as NodeJS.Timeout;
    const cancel = vi.fn();
    const scheduler = new FrameScheduler({
      now: () => 0,
      schedule: () => timer,
      cancel,
    });

    scheduler.start(vi.fn());
    scheduler.stop();

    expect(cancel).toHaveBeenCalledWith(timer);
  });
});
