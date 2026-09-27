import { describe, expect, it, vi } from "vitest";

import { YtDlpDaemonHealth } from "../src/media/youtube/daemon-health.js";

function makeLogger() {
  return { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() };
}

describe("YtDlpDaemonHealth", () => {
  it("starts unknown", () => {
    expect(new YtDlpDaemonHealth().snapshot()).toEqual({
      state: "unknown",
      consecutiveFailures: 0,
      fallbacksTotal: 0,
    });
  });

  it("warns at most once a minute while the daemon keeps failing", () => {
    let now = 0;
    const logger = makeLogger();
    const health = new YtDlpDaemonHealth({ logger, now: () => now });

    health.recordFailure("timeout");
    now = 30_000;
    health.recordFailure("timeout");
    expect(logger.warn).toHaveBeenCalledTimes(1);

    now = 61_000;
    health.recordFailure("timeout");
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(health.snapshot()).toMatchObject({
      state: "failing",
      consecutiveFailures: 3,
      fallbacksTotal: 3,
      lastFailureReason: "timeout",
      lastFailureAt: new Date(61_000).toISOString(),
    });
  });

  it("logs the recovery and warns again on the next failure", () => {
    let now = 0;
    const logger = makeLogger();
    const health = new YtDlpDaemonHealth({ logger, now: () => now });

    health.recordFailure("unreachable", "ECONNREFUSED");
    health.recordSuccess();
    expect(logger.info).toHaveBeenCalledWith(
      { failuresBeforeRecovery: 1 },
      "yt-dlp daemon recovered",
    );
    expect(health.snapshot()).toMatchObject({
      state: "ok",
      consecutiveFailures: 0,
      fallbacksTotal: 1,
    });

    now = 1_000;
    health.recordFailure("unreachable", "ECONNREFUSED");
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it("scrubs tokens and URLs from the daemon's error text", () => {
    const health = new YtDlpDaemonHealth();
    health.recordFailure(
      "daemon-error",
      "ERROR: https://rr1.googlevideo.com/videoplayback?sig=abc po_token=secret",
    );
    const detail = health.snapshot().lastFailureDetail ?? "";
    expect(detail).not.toContain("googlevideo");
    expect(detail).not.toContain("secret");
  });
});
