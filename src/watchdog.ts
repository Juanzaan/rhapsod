export interface WatchdogOptions {
  readonly intervalMs: number;
  readonly now?: () => number;
  readonly onTimeout: (driftMs: number) => void;
}

export function startWatchdog(options: WatchdogOptions): { stop(): void } {
  let lastTick = options.now?.() ?? Date.now();
  const handle = setInterval(() => {
    const now = options.now?.() ?? Date.now();
    const drift = now - lastTick;
    lastTick = now;
    if (drift > options.intervalMs * 2) options.onTimeout(drift);
  }, options.intervalMs);
  handle.unref();
  return { stop: () => clearInterval(handle) };
}

export const DEFAULT_WATCHDOG_SECONDS = 15;

/**
 * The watchdog fires when a tick arrives more than two intervals late, so
 * the old 15-minute default only caught event-loop stalls over half an
 * hour. The interval is now in seconds (default 15: stalls over 30 s).
 * The minutes key is honored only as the off switch (0): most env files
 * carry a copied "15" that would otherwise keep the half-hour blind spot.
 */
export function watchdogInterval(config: {
  readonly RHAPSOD_WATCHDOG_INTERVAL_SECONDS?: number | undefined;
  readonly RHAPSOD_WATCHDOG_INTERVAL_MINUTES?: number | undefined;
}): { readonly intervalMs: number; readonly ignoredMinutes: boolean } {
  const seconds = config.RHAPSOD_WATCHDOG_INTERVAL_SECONDS;
  const minutes = config.RHAPSOD_WATCHDOG_INTERVAL_MINUTES;
  if (seconds !== undefined) {
    return {
      intervalMs: seconds * 1_000,
      ignoredMinutes: minutes !== undefined,
    };
  }
  if (minutes === 0) return { intervalMs: 0, ignoredMinutes: false };
  return {
    intervalMs: DEFAULT_WATCHDOG_SECONDS * 1_000,
    ignoredMinutes: minutes !== undefined,
  };
}
