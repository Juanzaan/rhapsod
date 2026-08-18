export interface RateLimitResult {
  readonly allowed: boolean;
  readonly retryAfterMs: number;
}

export class CommandRateLimiter {
  readonly #lastUse = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  acquire(key: string, cooldownMs: number): RateLimitResult {
    const now = this.now();
    const lastUse = this.#lastUse.get(key);
    if (lastUse !== undefined) {
      const retryAfterMs = cooldownMs - (now - lastUse);
      if (retryAfterMs > 0) return { allowed: false, retryAfterMs };
    }
    this.#lastUse.set(key, now);
    return { allowed: true, retryAfterMs: 0 };
  }
}
