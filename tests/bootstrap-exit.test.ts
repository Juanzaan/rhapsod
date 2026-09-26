import { describe, expect, it, vi } from "vitest";

import { ExitCoordinator } from "../src/bootstrap/exit.js";

describe("ExitCoordinator", () => {
  it("flushes before exiting with the given code", async () => {
    const order: string[] = [];
    const exits = new ExitCoordinator({
      exit: (code) => order.push(`exit ${code}`),
    });
    exits.setFlush(async () => {
      await Promise.resolve();
      order.push("flush");
    });
    await exits.exit(1);
    expect(order).toEqual(["flush", "exit 1"]);
  });

  it("exits without a flush registered", async () => {
    const exit = vi.fn();
    await new ExitCoordinator({ exit }).exit(0);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("still exits when the flush fails", async () => {
    const exit = vi.fn();
    const exits = new ExitCoordinator({ exit });
    exits.setFlush(() => Promise.reject(new Error("disk full")));
    await exits.exit(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("gives up on a stuck flush after the timeout", async () => {
    const exit = vi.fn();
    const exits = new ExitCoordinator({ exit, flushTimeoutMs: 20 });
    exits.setFlush(() => new Promise<void>(() => undefined));
    await exits.exit(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("does not run the same flush twice when a second exit races the first", async () => {
    const flush = vi.fn(() => new Promise<void>(() => undefined));
    const exit = vi.fn();
    const exits = new ExitCoordinator({ exit, flushTimeoutMs: 20 });
    exits.setFlush(flush);
    await Promise.all([exits.exit(1), exits.exit(1)]);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(2);
  });
});
