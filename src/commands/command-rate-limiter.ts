interface RateLimitResult {
  readonly allowed: boolean;
  readonly retryAfterMs: number;
}

const MAX_KEYS = 1_000;
const KEY_RETENTION_MS = 10 * 60_000;

export class CommandRateLimiter {
  readonly #lastUse = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  acquire(key: string, cooldownMs: number): RateLimitResult {
    const now = this.now();
    if (this.#lastUse.size >= MAX_KEYS) {
      const cutoff = now - KEY_RETENTION_MS;
      for (const [storedKey, storedAt] of this.#lastUse) {
        if (storedAt < cutoff) {
          this.#lastUse.delete(storedKey);
        }
      }
    }
    const lastUse = this.#lastUse.get(key);
    if (lastUse !== undefined) {
      const retryAfterMs = cooldownMs - (now - lastUse);
      if (retryAfterMs > 0) return { allowed: false, retryAfterMs };
    }
    this.#lastUse.set(key, now);
    return { allowed: true, retryAfterMs: 0 };
  }
}
