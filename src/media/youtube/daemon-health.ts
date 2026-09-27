import { noopLogger, type MinimalLogger } from "../../observability/logger.js";
import { sanitizeSensitive, sanitizeUrl } from "../../observability/metrics.js";

export type DaemonFailureReason =
  | "timeout"
  | "unreachable"
  | "http-error"
  | "daemon-error"
  | "invalid-response";

export interface DaemonHealthSnapshot {
  /** "unknown" until the first resolve goes through the daemon. */
  readonly state: "ok" | "failing" | "unknown";
  readonly consecutiveFailures: number;
  readonly fallbacksTotal: number;
  readonly lastFailureReason?: DaemonFailureReason;
  readonly lastFailureDetail?: string;
  readonly lastFailureAt?: string;
}

const WARN_INTERVAL_MS = 60_000;

/**
 * Every daemon failure falls back to spawning yt-dlp, which still plays the
 * song, only slower. That fallback used to be silent, so a broken daemon
 * (expired cookies, POT provider down, hung process) went unnoticed for days.
 * The first failure after a success always logs; repeats log once a minute.
 */
export class YtDlpDaemonHealth {
  readonly #logger: MinimalLogger;
  readonly #now: () => number;
  #consecutiveFailures = 0;
  #fallbacksTotal = 0;
  #seen = false;
  #lastWarnAt: number | undefined;
  #lastFailure:
    | { reason: DaemonFailureReason; detail: string | undefined; at: number }
    | undefined;

  constructor(options: { logger?: MinimalLogger; now?: () => number } = {}) {
    this.#logger = options.logger ?? noopLogger;
    this.#now = options.now ?? Date.now;
  }

  recordSuccess(): void {
    this.#seen = true;
    if (this.#consecutiveFailures > 0) {
      this.#logger.info(
        { failuresBeforeRecovery: this.#consecutiveFailures },
        "yt-dlp daemon recovered",
      );
    }
    this.#consecutiveFailures = 0;
    this.#lastWarnAt = undefined;
  }

  recordFailure(reason: DaemonFailureReason, detail?: string): void {
    this.#seen = true;
    this.#consecutiveFailures++;
    this.#fallbacksTotal++;
    const now = this.#now();
    const scrubbed =
      detail === undefined
        ? undefined
        : sanitizeUrl(sanitizeSensitive(detail)).slice(0, 200);
    this.#lastFailure = { reason, detail: scrubbed, at: now };
    if (
      this.#lastWarnAt !== undefined &&
      now - this.#lastWarnAt < WARN_INTERVAL_MS
    ) {
      return;
    }
    this.#lastWarnAt = now;
    this.#logger.warn(
      {
        reason,
        ...(scrubbed === undefined ? {} : { detail: scrubbed }),
        consecutiveFailures: this.#consecutiveFailures,
        fallbacksTotal: this.#fallbacksTotal,
      },
      "yt-dlp daemon failed; falling back to spawning yt-dlp",
    );
  }

  snapshot(): DaemonHealthSnapshot {
    const failure = this.#lastFailure;
    return {
      state: !this.#seen
        ? "unknown"
        : this.#consecutiveFailures > 0
          ? "failing"
          : "ok",
      consecutiveFailures: this.#consecutiveFailures,
      fallbacksTotal: this.#fallbacksTotal,
      ...(failure === undefined
        ? {}
        : {
            lastFailureReason: failure.reason,
            ...(failure.detail === undefined
              ? {}
              : { lastFailureDetail: failure.detail }),
            lastFailureAt: new Date(failure.at).toISOString(),
          }),
    };
  }
}
