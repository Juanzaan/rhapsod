import { afterEach, describe, expect, it, vi } from "vitest";

import { loadConfig } from "../src/config.js";
import { startWatchdog, watchdogInterval } from "../src/watchdog.js";

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

describe("watchdogInterval", () => {
  const base = { RHAPSOD_TS3_HOST: "ts.example.com" };

  it("defaults to 15 seconds so stalls over 30 s are caught", () => {
    // Regression: the 15-minute default only fired after a 30-minute stall.
    expect(watchdogInterval(loadConfig(base))).toEqual({
      intervalMs: 15_000,
      ignoredMinutes: false,
    });
  });

  it("uses the seconds key, including 0 to turn it off", () => {
    expect(
      watchdogInterval(
        loadConfig({ ...base, RHAPSOD_WATCHDOG_INTERVAL_SECONDS: "5" }),
      ).intervalMs,
    ).toBe(5_000);
    expect(
      watchdogInterval(
        loadConfig({ ...base, RHAPSOD_WATCHDOG_INTERVAL_SECONDS: "0" }),
      ).intervalMs,
    ).toBe(0);
  });

  it("honors the deprecated minutes key only as the off switch", () => {
    expect(
      watchdogInterval(
        loadConfig({ ...base, RHAPSOD_WATCHDOG_INTERVAL_MINUTES: "0" }),
      ),
    ).toEqual({ intervalMs: 0, ignoredMinutes: false });
    expect(
      watchdogInterval(
        loadConfig({ ...base, RHAPSOD_WATCHDOG_INTERVAL_MINUTES: "15" }),
      ),
    ).toEqual({ intervalMs: 15_000, ignoredMinutes: true });
    expect(
      watchdogInterval(
        loadConfig({
          ...base,
          RHAPSOD_WATCHDOG_INTERVAL_MINUTES: "15",
          RHAPSOD_WATCHDOG_INTERVAL_SECONDS: "20",
        }),
      ),
    ).toEqual({ intervalMs: 20_000, ignoredMinutes: true });
  });
});
