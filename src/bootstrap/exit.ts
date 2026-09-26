import type { Logger } from "pino";

const EXIT_FLUSH_TIMEOUT_MS = 5_000;

export interface ExitCoordinatorOptions {
  readonly exit?: (code: number) => void;
  readonly flushTimeoutMs?: number;
}

/**
 * Favorites, history, telemetry and the queue are written on a debounce, so
 * a bare process.exit() drops whatever changed since the last write. The
 * flush is registered once the stores exist; every exit path goes through
 * `exit()` so crashes, the watchdog and panel restarts keep that data.
 */
export class ExitCoordinator {
  #flush: (() => Promise<void>) | undefined;
  readonly #exit: (code: number) => void;
  readonly #flushTimeoutMs: number;

  constructor(options: ExitCoordinatorOptions = {}) {
    this.#exit = options.exit ?? ((code) => process.exit(code));
    this.#flushTimeoutMs = options.flushTimeoutMs ?? EXIT_FLUSH_TIMEOUT_MS;
  }

  setFlush(flush: (() => Promise<void>) | undefined): void {
    this.#flush = flush;
  }

  async exit(code: number): Promise<void> {
    const flush = this.#flush;
    // A second crash while flushing must not wait on the same stuck flush.
    this.#flush = undefined;
    if (flush !== undefined) {
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        flush().catch(() => undefined),
        new Promise((resolve) => {
          timer = setTimeout(resolve, this.#flushTimeoutMs);
        }),
      ]);
      clearTimeout(timer);
    }
    this.#exit(code);
  }
}

/** Crashes flush and exit 1 so systemd restarts the bot. */
export function installCrashHandlers(
  logger: Logger,
  exits: ExitCoordinator,
): void {
  // pino only serializes Error objects under the `err` key; any other key
  // logs them as `{}`, which is how crash reports lost their message.
  process.on("unhandledRejection", (reason: unknown) => {
    logger.error({ err: reason }, "Unhandled promise rejection; restarting");
    void exits.exit(1);
  });
  process.on("uncaughtException", (error: Error) => {
    logger.error({ err: error }, "Uncaught exception; restarting");
    void exits.exit(1);
  });
}

export function onStopSignal(handler: () => void): void {
  process.once("SIGINT", handler);
  process.once("SIGTERM", handler);
}
