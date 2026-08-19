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
