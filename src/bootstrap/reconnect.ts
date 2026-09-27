import {
  withTimeout,
  type Ts3Connection,
} from "../adapters/ts3/ts3-connection.js";
import type { MinimalLogger } from "../observability/logger.js";

export interface ReconnectorOptions {
  readonly connection: Pick<Ts3Connection, "connect" | "disconnect">;
  readonly logger: MinimalLogger;
  readonly onDisconnect: (reason: string) => void;
  /** Resyncs views after the connection is back, before talk power. */
  readonly onReconnected: () => Promise<void>;
  /** Runs once `reconnecting` is false again; then playback resumes. */
  readonly onResumed: () => Promise<void>;
  readonly onGiveUp: () => Promise<void>;
  /** Runs before each attempt's backoff; feeds the reconnect notice. */
  readonly onAttempt?: (attempt: number, maxAttempts: number) => void;
  readonly isShuttingDown: () => boolean;
  readonly maxAttempts?: number;
  readonly attemptTimeoutMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const MAX_ATTEMPTS = 5;
// Reconnect attempts must fail fast: a stuck handshake would otherwise eat
// the whole startup-style timeout (minutes) before the next attempt runs.
const ATTEMPT_TIMEOUT_MS = 30_000;

/** 5, 10, 20, 40, 80 s: about two and a half minutes before giving up. */
export function reconnectDelayMs(attempt: number): number {
  return Math.min(80, 5 * 2 ** (attempt - 1)) * 1_000;
}

/**
 * Reconnects after the TeamSpeak connection drops, with exponential
 * backoff. After the last attempt fails, `onGiveUp` flushes and exits so
 * systemd restarts the bot from a clean process.
 */
export class Reconnector {
  readonly #options: ReconnectorOptions;
  readonly #maxAttempts: number;
  readonly #sleep: (ms: number) => Promise<void>;
  #reconnecting = false;

  constructor(options: ReconnectorOptions) {
    this.#options = options;
    this.#maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
    this.#sleep =
      options.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  get reconnecting(): boolean {
    return this.#reconnecting;
  }

  /** Starts the reconnect loop unless one is running or the bot is stopping. */
  connectionLost(reason: string): Promise<void> {
    if (this.#reconnecting || this.#options.isShuttingDown())
      return Promise.resolve();
    this.#reconnecting = true;
    this.#options.onDisconnect(reason);
    return this.#loop(reason);
  }

  async #loop(reason: string): Promise<void> {
    const { connection, logger } = this.#options;
    const maxReconnectAttempts = this.#maxAttempts;
    for (let attempt = 1; attempt <= maxReconnectAttempts; attempt++) {
      const delayMs = reconnectDelayMs(attempt);
      this.#options.onAttempt?.(attempt, maxReconnectAttempts);
      logger.warn(
        {
          attempt,
          delaySeconds: delayMs / 1_000,
          maxReconnectAttempts,
          reason,
        },
        "TeamSpeak connection lost; reconnecting",
      );
      await this.#sleep(delayMs);
      try {
        await withTimeout(
          // Skip the duplicate check here: our own ghost can still be
          // listed right after a dropped connection, and refusing there
          // would keep a live bot down on every network blip.
          connection.connect({ skipDuplicateCheck: true }),
          this.#options.attemptTimeoutMs ?? ATTEMPT_TIMEOUT_MS,
          "Reconnect attempt timed out",
        );
        logger.info({ attempt }, "Reconnected to TeamSpeak 3");
        await this.#options.onReconnected();
        this.#reconnecting = false;
        await this.#options.onResumed();
        return;
      } catch (error) {
        logger.error({ attempt, err: error }, "TeamSpeak reconnect failed");
        // A timed-out attempt may leave a half-open client behind;
        // make sure the next attempt starts from a clean state.
        await connection.disconnect().catch(() => undefined);
      }
    }
    logger.error(
      { maxReconnectAttempts },
      "Reconnect limit reached; flushing state and stopping bot",
    );
    await this.#options.onGiveUp();
  }
}
