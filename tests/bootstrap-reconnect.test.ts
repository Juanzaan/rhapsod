import { describe, expect, it, vi } from "vitest";

import { Reconnector, reconnectDelayMs } from "../src/bootstrap/reconnect.js";
import { noopLogger } from "../src/observability/logger.js";

function harness(connectResults: readonly ("ok" | "fail" | "hang")[]) {
  const results = [...connectResults];
  const calls: string[] = [];
  const delays: number[] = [];
  let shuttingDown = false;
  const connection = {
    connect: vi.fn((options?: { skipDuplicateCheck?: boolean }) => {
      calls.push(`connect skip=${String(options?.skipDuplicateCheck)}`);
      const next = results.shift() ?? "fail";
      if (next === "ok") return Promise.resolve();
      if (next === "hang") return new Promise<void>(() => undefined);
      return Promise.reject(new Error("refused"));
    }),
    disconnect: vi.fn(() => {
      calls.push("disconnect");
      return Promise.resolve();
    }),
  };
  const reconnector: Reconnector = new Reconnector({
    attemptTimeoutMs: 20,
    connection,
    isShuttingDown: () => shuttingDown,
    logger: noopLogger,
    onDisconnect: (reason) => calls.push(`lost ${reason}`),
    onGiveUp: () => {
      calls.push("give up");
      return Promise.resolve();
    },
    onReconnected: () => {
      calls.push(`resync reconnecting=${String(reconnector.reconnecting)}`);
      return Promise.resolve();
    },
    onResumed: () => {
      calls.push(`resumed reconnecting=${String(reconnector.reconnecting)}`);
      return Promise.resolve();
    },
    sleep: (ms) => {
      delays.push(ms);
      return Promise.resolve();
    },
  });
  return {
    calls,
    delays,
    reconnector,
    stop: () => {
      shuttingDown = true;
    },
  };
}

describe("Reconnector", () => {
  it("backs off 5, 10, 20, 40 and 80 s", () => {
    expect([1, 2, 3, 4, 5, 6].map(reconnectDelayMs)).toEqual([
      5_000, 10_000, 20_000, 40_000, 80_000, 80_000,
    ]);
  });

  it("reconnects, resyncs, then resumes once no longer reconnecting", async () => {
    const { calls, delays, reconnector } = harness(["fail", "ok"]);
    await reconnector.connectionLost("timeout");

    expect(delays).toEqual([5_000, 10_000]);
    expect(calls).toEqual([
      "lost timeout",
      "connect skip=true",
      "disconnect",
      "connect skip=true",
      "resync reconnecting=true",
      "resumed reconnecting=false",
    ]);
  });

  it("ignores a second loss while a reconnect is running", async () => {
    const { calls, reconnector } = harness(["ok"]);
    const first = reconnector.connectionLost("kicked");
    await reconnector.connectionLost("timeout");
    await first;
    expect(calls.filter((call) => call.startsWith("lost"))).toEqual([
      "lost kicked",
    ]);
  });

  it("does nothing while the bot is shutting down", async () => {
    const { calls, reconnector, stop } = harness(["ok"]);
    stop();
    await reconnector.connectionLost("timeout");
    expect(calls).toEqual([]);
  });

  it("times out a stuck attempt and gives up after five", async () => {
    const { calls, delays, reconnector } = harness([
      "hang",
      "fail",
      "fail",
      "fail",
      "fail",
    ]);
    await reconnector.connectionLost("timeout");

    expect(delays).toHaveLength(5);
    expect(calls.filter((call) => call === "disconnect")).toHaveLength(5);
    expect(calls.at(-1)).toBe("give up");
  });

  it("reports each attempt with the limit before its backoff", async () => {
    const attempts: string[] = [];
    let connects = 0;
    const reconnector = new Reconnector({
      connection: {
        connect: () =>
          ++connects < 3
            ? Promise.reject(new Error("refused"))
            : Promise.resolve(),
        disconnect: () => Promise.resolve(),
      },
      isShuttingDown: () => false,
      logger: noopLogger,
      maxAttempts: 4,
      onAttempt: (attempt, max) =>
        attempts.push(`${String(attempt)}/${String(max)}`),
      onDisconnect: () => undefined,
      onGiveUp: () => Promise.resolve(),
      onReconnected: () => Promise.resolve(),
      onResumed: () => Promise.resolve(),
      sleep: () => Promise.resolve(),
    });
    await reconnector.connectionLost("timeout");
    expect(attempts).toEqual(["1/4", "2/4", "3/4"]);
  });
});
