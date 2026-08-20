import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createHeartbeat } from "../src/adapters/ts3/ts3-connection.js";

describe("createHeartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("probes at the given interval and reports failures", () => {
    const probe = vi.fn(() => Promise.resolve());
    const onLost = vi.fn();

    createHeartbeat(probe, 1_000, onLost);
    expect(probe).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_000);
    expect(probe).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2_000);
    expect(probe).toHaveBeenCalledTimes(3);
    expect(onLost).not.toHaveBeenCalled();
  });

  it("reports a failed probe as a lost connection", async () => {
    const probe = vi.fn(() => Promise.reject(new Error("no response")));
    const onLost = vi.fn();

    createHeartbeat(probe, 1_000, onLost);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it("stops probing when cleared", () => {
    const probe = vi.fn(() => Promise.resolve());
    const onLost = vi.fn();

    const stop = createHeartbeat(probe, 1_000, onLost);
    stop();
    vi.advanceTimersByTime(5_000);

    expect(probe).not.toHaveBeenCalled();
  });
});
