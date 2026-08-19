import { afterEach, describe, expect, it, vi } from "vitest";

import { startWatchdog } from "../src/watchdog.js";

describe("startWatchdog", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not fire while ticks arrive on time", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    let now = 1_000;
    startWatchdog({
      intervalMs: 1_000,
      now: () => now,
      onTimeout,
    });
    now += 1_000;
    vi.advanceTimersByTime(1_000);
    now += 1_000;
    vi.advanceTimersByTime(1_000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("fires when the event loop stalls past twice the interval", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    let now = 1_000;
    const watchdog = startWatchdog({
      intervalMs: 1_000,
      now: () => now,
      onTimeout,
    });
    now += 5_000;
    vi.advanceTimersByTime(1_000);
    expect(onTimeout).toHaveBeenCalledWith(5_000);
    watchdog.stop();
  });
});
