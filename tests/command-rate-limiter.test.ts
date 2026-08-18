import { describe, expect, it } from "vitest";

import { CommandRateLimiter } from "../src/commands/command-rate-limiter.js";

describe("CommandRateLimiter", () => {
  it("allows the first command and rejects reuse during cooldown", () => {
    let now = 1_000;
    const limiter = new CommandRateLimiter(() => now);

    expect(limiter.acquire("user-1", 1_500)).toEqual({
      allowed: true,
      retryAfterMs: 0,
    });
    now = 2_000;
    expect(limiter.acquire("user-1", 1_500)).toEqual({
      allowed: false,
      retryAfterMs: 500,
    });
  });

  it("tracks keys independently and allows reuse after cooldown", () => {
    let now = 1_000;
    const limiter = new CommandRateLimiter(() => now);
    limiter.acquire("user-1", 1_500);

    expect(limiter.acquire("user-2", 1_500).allowed).toBe(true);
    now = 2_500;
    expect(limiter.acquire("user-1", 1_500).allowed).toBe(true);
  });
});
