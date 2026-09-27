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

  it("skips missed deadlines and keeps a single frame per tick", () => {
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
    expect(delays).toEqual([20, 20]);
    expect(callbacks).toHaveLength(1);
  });

  it("does not emit a burst after a long stall", () => {
    let now = 0;
    const callbacks: Array<() => void> = [];
    const scheduler = new FrameScheduler({
      now: () => now,
      schedule: (callback) => {
        callbacks.push(callback);
        return {} as NodeJS.Timeout;
      },
    });
    const onFrame = vi.fn();

    scheduler.start(onFrame);
    now = 20_000;
    callbacks.shift()?.();

    expect(onFrame).toHaveBeenCalledTimes(1);
  });

  it("counts how late each tick fires and when the clock slips", () => {
    let now = 0;
    const callbacks: Array<() => void> = [];
    const scheduler = new FrameScheduler({
      now: () => now,
      schedule: (callback) => {
        callbacks.push(callback);
        return {} as NodeJS.Timeout;
      },
    });

    scheduler.start(vi.fn());
    now = 20.5; // due at 20: 0.5 ms late
    callbacks.shift()?.();
    now = 43; // due at 40: 3 ms late
    callbacks.shift()?.();
    now = 130; // due at 60: 70 ms late, drops the base
    callbacks.shift()?.();
    now = 150; // due at 150 after the slip: on time
    callbacks.shift()?.();

    expect(scheduler.timing).toEqual({
      clockSlips: 1,
      latenessCounts: [2, 0, 1, 0, 0, 0, 1],
      latenessSumMs: 73.5,
      maxLatenessMs: 70,
      ticks: 4,
    });
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
