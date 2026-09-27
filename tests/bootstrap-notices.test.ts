import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { NoticeRegistry } from "../src/application/notices/notice-registry.js";
import {
  NoticeMonitor,
  type NoticeConfig,
  type NoticeMonitorOptions,
} from "../src/bootstrap/notices.js";
import { noopLogger } from "../src/observability/logger.js";

const MB = 1024 * 1024;
const NOW = Date.UTC(2026, 8, 27);

const baseConfig: NoticeConfig = {
  RHAPSOD_PANEL_ENABLED: true,
  RHAPSOD_PANEL_HOST: "127.0.0.1",
  RHAPSOD_WARP_PROXY: undefined,
  RHAPSOD_YTDLP_COOKIES_PATH: undefined,
  RHAPSOD_YTDLP_DAEMON_URL: undefined,
  RHAPSOD_YTDLP_EXTRACTOR_ARGS: undefined,
};

const monitors: NoticeMonitor[] = [];

function monitor(
  overrides: Partial<Omit<NoticeMonitorOptions, "config">> & {
    config?: Partial<NoticeConfig>;
  } = {},
): NoticeMonitor {
  const now = overrides.now ?? (() => NOW);
  const created = new NoticeMonitor({
    dataDir: "/unused",
    logger: noopLogger,
    registry: new NoticeRegistry({ now }),
    now,
    freeBytes: () => Promise.resolve(10_000 * MB),
    readCookies: () => Promise.resolve(undefined),
    probe: () => Promise.resolve(true),
    ...overrides,
    config: { ...baseConfig, ...overrides.config },
  });
  monitors.push(created);
  return created;
}

afterEach(() => {
  for (const created of monitors.splice(0)) created.stop();
});

describe("NoticeMonitor", () => {
  it("opens a critical notice at start when the panel is exposed", () => {
    const notices = monitor({ config: { RHAPSOD_PANEL_HOST: "0.0.0.0" } });
    notices.start();
    expect(notices.registry.verdict()).toBe("unhealthy");
    expect(notices.registry.list()[0]?.key).toBe("panel.bind-exposed");
  });

  it("detects a restart loop from the starts kept in notices.json", async () => {
    const filePath = join(
      mkdtempSync(join(tmpdir(), "rhapsod-notices-")),
      "notices.json",
    );
    let now = NOW;
    const boot = async (): Promise<NoticeMonitor> => {
      const created = monitor({
        now: () => now,
        registry: new NoticeRegistry({ filePath, now: () => now }),
      });
      created.start();
      // The exit path flushes the registry before the process ends.
      await created.flush();
      created.stop();
      now += 60_000;
      return created;
    };
    for (let i = 0; i < 3; i++) {
      expect((await boot()).registry.list()).toEqual([]);
    }
    expect((await boot()).registry.list()[0]).toMatchObject({
      key: "process.restart-loop",
      severity: "critical",
    });
  });

  it("moves between YouTube categories and clears them all on a pass", () => {
    const notices = monitor();
    notices.youtubeCheckFailed("cookies-invalid");
    expect(notices.registry.list().map((notice) => notice.key)).toEqual([
      "youtube.cookies-invalid",
    ]);
    notices.youtubeCheckFailed("soft-block");
    expect(notices.registry.list().map((notice) => notice.key)).toEqual([
      "youtube.soft-block",
    ]);
    notices.youtubeCheckPassed();
    expect(notices.registry.list()).toEqual([]);
  });

  it("needs two failed canaries before extraction-failed opens", () => {
    let now = NOW;
    const notices = monitor({
      now: () => now,
      registry: new NoticeRegistry({ now: () => now }),
    });
    notices.youtubeCheckFailed("extraction-failed");
    expect(notices.registry.list()).toEqual([]);
    now += 15 * 60_000;
    notices.youtubeCheckFailed("extraction-failed");
    expect(notices.registry.list()[0]?.key).toBe("youtube.extraction-failed");
  });

  it("tracks talk power and the reconnect loop", () => {
    const notices = monitor();
    notices.talkPower(false, 12);
    expect(notices.registry.get("ts3.no-talk-power")?.data).toEqual({
      channelId: 12,
    });
    notices.talkPower(true, 12);
    expect(notices.registry.get("ts3.no-talk-power")).toBeUndefined();

    notices.reconnectAttempt(1, 5);
    notices.reconnectAttempt(3, 5);
    expect(notices.registry.get("ts3.reconnecting")?.severity).toBe("error");
    notices.reconnected();
    expect(notices.registry.list()).toEqual([]);

    notices.reconnectAttempt(5, 5);
    notices.reconnectGaveUp();
    expect(notices.registry.list()).toMatchObject([
      {
        key: "ts3.reconnecting:gave-up",
        severity: "critical",
        persistent: true,
        data: { maxAttempts: 5 },
      },
    ]);
  });

  it("records an event-loop stall as a persistent notice", () => {
    const notices = monitor();
    notices.eventLoopStall(42_400);
    expect(notices.registry.list()[0]).toMatchObject({
      key: "process.event-loop-stall",
      persistent: true,
      data: { driftMs: 42_400 },
    });
  });

  it("opens the daemon notice after three fallbacks and clears after three OKs", () => {
    let snapshot = {
      state: "failing" as "failing" | "ok",
      consecutiveFailures: 3,
      fallbacksTotal: 3,
    };
    const notices = monitor({ daemonHealth: () => snapshot });
    notices.checkDaemon();
    expect(notices.registry.list()[0]?.key).toBe("ytdlp.daemon-fallback");
    snapshot = { state: "ok", consecutiveFailures: 0, fallbacksTotal: 3 };
    notices.checkDaemon();
    notices.checkDaemon();
    expect(notices.registry.list()).toHaveLength(1);
    notices.checkDaemon();
    expect(notices.registry.list()).toEqual([]);
  });

  it("holds the disk notice inside the clear margin", async () => {
    let free = 900 * MB;
    const notices = monitor({ freeBytes: () => Promise.resolve(free) });
    await notices.checkDisk();
    expect(notices.registry.get("disk.data-low")?.severity).toBe("warning");
    free = 1050 * MB;
    await notices.checkDisk();
    expect(notices.registry.get("disk.data-low")?.state).toBe("open");
    free = 2000 * MB;
    await notices.checkDisk();
    expect(notices.registry.get("disk.data-low")).toBeUndefined();
  });

  it("skips the disk check when statfs fails", async () => {
    const notices = monitor({
      freeBytes: () => Promise.reject(new Error("ENOSYS")),
    });
    await notices.checkDisk();
    expect(notices.registry.list()).toEqual([]);
  });

  it("checks the cookies file only when one is configured", async () => {
    const reads: string[] = [];
    const notices = monitor({
      readCookies: (path) => {
        reads.push(path);
        return Promise.resolve(undefined);
      },
    });
    await notices.checkCookies();
    expect(reads).toEqual([]);

    const configured = monitor({
      config: { RHAPSOD_YTDLP_COOKIES_PATH: "/data/youtube-cookies.txt" },
      readCookies: (path) => {
        reads.push(path);
        return Promise.resolve(undefined);
      },
    });
    await configured.checkCookies();
    expect(reads).toEqual(["/data/youtube-cookies.txt"]);
    expect(configured.registry.list()[0]).toMatchObject({
      key: "youtube.cookies-expiring",
      titleEs: "No se encuentra el archivo de cookies de YouTube",
    });
  });

  it("treats an empty cookies file as no cookies, not a broken one", async () => {
    const notices = monitor({
      config: { RHAPSOD_YTDLP_COOKIES_PATH: "/data/youtube-cookies.txt" },
      readCookies: () => Promise.resolve(""),
    });
    await notices.checkCookies();
    expect(notices.registry.list()).toEqual([]);
  });

  describe("PO token provider", () => {
    let server: Server | undefined;
    afterEach(async () => {
      await new Promise<void>((resolve) => {
        if (server === undefined) resolve();
        else server.close(() => resolve());
      });
      server = undefined;
    });

    it("probes nothing when no provider is configured", async () => {
      const probed: unknown[] = [];
      const notices = monitor({
        probe: (endpoint) => {
          probed.push(endpoint);
          return Promise.resolve(false);
        },
      });
      await notices.checkPot();
      expect(probed).toEqual([]);
    });

    it("opens after three failed connects to a real closed port", async () => {
      server = createServer();
      await new Promise<void>((resolve) =>
        server?.listen(0, "127.0.0.1", resolve),
      );
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error();
      const port = address.port;
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = undefined;

      const notices = new NoticeMonitor({
        config: {
          ...baseConfig,
          RHAPSOD_YTDLP_EXTRACTOR_ARGS: `youtube:po_token_uri=http://127.0.0.1:${String(port)}`,
        },
        dataDir: "/unused",
        logger: noopLogger,
        registry: new NoticeRegistry(),
      });
      monitors.push(notices);
      await notices.checkPot();
      await notices.checkPot();
      expect(notices.registry.list()).toEqual([]);
      await notices.checkPot();
      expect(notices.registry.list()[0]?.data).toEqual({
        host: "127.0.0.1",
        port,
      });

      server = createServer((socket) => socket.destroy());
      await new Promise<void>((resolve) =>
        server?.listen(port, "127.0.0.1", resolve),
      );
      await notices.checkPot();
      expect(notices.registry.list()).toEqual([]);
    });
  });
});
