import { readFile, statfs } from "node:fs/promises";
import { connect } from "node:net";
import { join } from "node:path";

import {
  cookiesFinding,
  daemonFallbackFinding,
  diskFinding,
  eventLoopStallFinding,
  noTalkPowerFinding,
  panelBindFinding,
  potEndpoint,
  potProviderDownFinding,
  reconnectGaveUpFinding,
  reconnectingFinding,
  restartLoopFinding,
  summarizeCookiesFile,
  youtubeAuthFinding,
  YOUTUBE_AUTH_DETECTORS,
  type CookiesFileSummary,
  type PotEndpoint,
} from "../application/notices/detectors.js";
import type { Finding } from "../application/notices/notice.js";
import { NoticeRegistry } from "../application/notices/notice-registry.js";
import type { AppConfig } from "../config.js";
import type { YoutubeAuthFailureCategory } from "../lib/youtube-auth-health.js";
import type { DaemonHealthSnapshot } from "../media/youtube/daemon-health.js";
import type { MinimalLogger } from "../observability/logger.js";

const MINUTE = 60_000;
const SWEEP_INTERVAL_MS = MINUTE;
const PROBE_INTERVAL_MS = MINUTE;
const DISK_INTERVAL_MS = 10 * MINUTE;
const COOKIES_INTERVAL_MS = 12 * 60 * MINUTE;
const POT_CONNECT_TIMEOUT_MS = 3_000;

export type NoticeConfig = Pick<
  AppConfig,
  | "RHAPSOD_PANEL_ENABLED"
  | "RHAPSOD_PANEL_HOST"
  | "RHAPSOD_WARP_PROXY"
  | "RHAPSOD_YTDLP_COOKIES_PATH"
  | "RHAPSOD_YTDLP_DAEMON_URL"
  | "RHAPSOD_YTDLP_EXTRACTOR_ARGS"
>;

export interface NoticeMonitorOptions {
  readonly config: NoticeConfig;
  readonly dataDir: string;
  readonly logger: MinimalLogger;
  readonly registry?: NoticeRegistry;
  readonly now?: () => number;
  /** Undefined when no yt-dlp daemon is configured. */
  readonly daemonHealth?: () => DaemonHealthSnapshot | undefined;
  readonly freeBytes?: (dir: string) => Promise<number>;
  readonly readCookies?: (path: string) => Promise<string | undefined>;
  readonly probe?: (endpoint: PotEndpoint) => Promise<boolean>;
}

/**
 * Feeds the notice registry. Every check here only reads (files, disk
 * space, a TCP connect to a local port, state the bot already tracks);
 * repairs are a later phase and go through explicit, reviewed actions.
 */
export class NoticeMonitor {
  readonly registry: NoticeRegistry;
  readonly #options: NoticeMonitorOptions;
  readonly #now: () => number;
  readonly #pot: PotEndpoint | undefined;
  readonly #timers: NodeJS.Timeout[] = [];
  #reconnectMaxAttempts = 0;

  constructor(options: NoticeMonitorOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.registry =
      options.registry ??
      new NoticeRegistry({
        filePath: join(options.dataDir, "notices.json"),
        logger: options.logger,
        now: this.#now,
      });
    this.#pot = potEndpoint(options.config);
  }

  /** Runs the startup checks and schedules the periodic ones. */
  start(): void {
    // No OK here: a restart loop notice clears only after an hour without
    // new starts (its expiry), not on the first calm boot.
    const restartLoop = restartLoopFinding(
      this.registry.recordStart(),
      this.#now(),
    );
    if (restartLoop !== undefined) this.registry.report(restartLoop);
    // Written now, not on the debounce: a crash loop usually dies within
    // seconds, before any exit flush is registered.
    void this.registry.flush();
    this.#reportOrOk(
      panelBindFinding(this.#options.config),
      "panel.bind-exposed",
    );
    void this.checkDisk();
    void this.checkCookies();
    void this.checkPot();
    this.#every(SWEEP_INTERVAL_MS, () => {
      this.registry.sweep();
    });
    this.#every(DISK_INTERVAL_MS, () => this.checkDisk());
    this.#every(COOKIES_INTERVAL_MS, () => this.checkCookies());
    if (this.#pot !== undefined) {
      this.#every(PROBE_INTERVAL_MS, () => this.checkPot());
    }
    if (this.#options.daemonHealth !== undefined) {
      this.#every(PROBE_INTERVAL_MS, () => {
        this.checkDaemon();
      });
    }
  }

  stop(): void {
    for (const timer of this.#timers.splice(0)) clearInterval(timer);
  }

  flush(): Promise<void> {
    return this.registry.flush();
  }

  youtubeCheckPassed(): void {
    for (const detector of YOUTUBE_AUTH_DETECTORS) this.registry.ok(detector);
  }

  youtubeCheckFailed(category: YoutubeAuthFailureCategory): void {
    const finding = youtubeAuthFinding(
      category,
      this.#options.config.RHAPSOD_WARP_PROXY !== undefined,
    );
    for (const detector of YOUTUBE_AUTH_DETECTORS) {
      if (detector !== finding.detector) this.registry.ok(detector);
    }
    this.registry.report(finding);
  }

  talkPower(canTalk: boolean, channelId: number): void {
    if (canTalk) this.registry.ok("ts3.no-talk-power");
    else this.registry.report(noTalkPowerFinding(channelId));
  }

  reconnectAttempt(attempt: number, maxAttempts: number): void {
    this.#reconnectMaxAttempts = maxAttempts;
    this.registry.report(reconnectingFinding(attempt, maxAttempts));
  }

  reconnected(): void {
    this.registry.ok("ts3.reconnecting");
  }

  /** Called right before the process exits; the flush on exit saves it. */
  reconnectGaveUp(): void {
    this.registry.ok("ts3.reconnecting");
    this.registry.report(reconnectGaveUpFinding(this.#reconnectMaxAttempts));
  }

  /** Same: the watchdog exits next, the notice is read on the next boot. */
  eventLoopStall(driftMs: number): void {
    this.registry.report(eventLoopStallFinding(driftMs));
  }

  checkDaemon(): void {
    const snapshot = this.#options.daemonHealth?.();
    if (snapshot === undefined) return;
    this.#reportOrOk(daemonFallbackFinding(snapshot), "ytdlp.daemon-fallback");
  }

  async checkDisk(): Promise<void> {
    const freeBytes = this.#options.freeBytes ?? defaultFreeBytes;
    let free: number;
    try {
      free = await freeBytes(this.#options.dataDir);
    } catch (error) {
      this.#options.logger.debug({ err: error }, "Disk space check failed");
      return;
    }
    this.#apply(
      diskFinding(free, this.#isOpen("disk.data-low")),
      "disk.data-low",
    );
  }

  async checkCookies(): Promise<void> {
    const path = this.#options.config.RHAPSOD_YTDLP_COOKIES_PATH;
    if (path === undefined) {
      this.registry.ok("youtube.cookies-expiring");
      return;
    }
    const read = this.#options.readCookies ?? defaultReadCookies;
    let summary: CookiesFileSummary | "missing";
    try {
      const text = await read(path);
      // A fresh install leaves the file empty until the owner loads cookies,
      // which is a valid setup (YouTube often works without them).
      if (text !== undefined && text.trim() === "") {
        this.registry.ok("youtube.cookies-expiring");
        return;
      }
      summary = text === undefined ? "missing" : summarizeCookiesFile(text);
    } catch (error) {
      this.#options.logger.debug({ err: error }, "Cookies check failed");
      return;
    }
    this.#apply(
      cookiesFinding(
        summary,
        this.#now(),
        this.#isOpen("youtube.cookies-expiring"),
      ),
      "youtube.cookies-expiring",
    );
  }

  async checkPot(): Promise<void> {
    const endpoint = this.#pot;
    if (endpoint === undefined) return;
    const probe = this.#options.probe ?? defaultProbe;
    if (await probe(endpoint)) this.registry.ok("pot.provider-down");
    else this.registry.report(potProviderDownFinding(endpoint));
  }

  #isOpen(key: string): boolean {
    const state = this.registry.get(key)?.state;
    return state === "open" || state === "ignored";
  }

  #apply(result: Finding | "ok" | "hold", detector: Finding["detector"]): void {
    if (result === "hold") return;
    this.#reportOrOk(result === "ok" ? undefined : result, detector);
  }

  #reportOrOk(
    finding: Finding | undefined,
    detector: Finding["detector"],
  ): void {
    if (finding === undefined) this.registry.ok(detector);
    else this.registry.report(finding);
  }

  #every(intervalMs: number, run: () => void | Promise<void>): void {
    const timer = setInterval(() => {
      void Promise.resolve()
        .then(run)
        .catch((error: unknown) => {
          this.#options.logger.error({ err: error }, "Notice check failed");
        });
    }, intervalMs);
    timer.unref();
    this.#timers.push(timer);
  }
}

async function defaultFreeBytes(dir: string): Promise<number> {
  const stats = await statfs(dir);
  return stats.bavail * stats.bsize;
}

async function defaultReadCookies(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function defaultProbe(endpoint: PotEndpoint): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: endpoint.host, port: endpoint.port });
    const done = (ok: boolean): void => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(POT_CONNECT_TIMEOUT_MS, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}
