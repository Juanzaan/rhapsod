import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPanelServer } from "../src/panel/panel-server.js";
import type { AppConfig } from "../src/config.js";

const noop = () => undefined;
const logger = {
  info: noop,
  warn: noop,
  error: noop,
  debug: noop,
  fatal: noop,
  trace: noop,
  silent: noop,
} as never;

function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    RHAPSOD_ADMIN_UIDS: "",
    RHAPSOD_PRIVATE_COMMAND_UIDS: "",
    RHAPSOD_DATA_DIR: "./data",
    RHAPSOD_FFMPEG_PATH: undefined,
    RHAPSOD_FFMPEG_USER_AGENT: undefined,
    RHAPSOD_FFPROBE_PATH: undefined,
    RHAPSOD_LOG_LEVEL: "info",
    RHAPSOD_MOVE_GROUP_IDS: "",
    RHAPSOD_MOVE_ADMIN_CHANNELS: "",
    RHAPSOD_MOVE_SENIOR_CHANNELS: "",
    RHAPSOD_MOVE_ADMIN_GROUP_IDS: "",
    RHAPSOD_MOVE_SENIOR_GROUP_IDS: "",
    RHAPSOD_LOG_RETENTION_DAYS: 14,
    RHAPSOD_METRICS_INTERVAL_MINUTES: 0,
    RHAPSOD_WATCHDOG_INTERVAL_MINUTES: 0,
    RHAPSOD_MAX_CONCURRENT_COMMANDS: 3,
    RHAPSOD_MAX_CONCURRENT_YTDLP_JOBS: undefined,
    RHAPSOD_MAX_QUEUE_TRACKS: 200,
    RHAPSOD_MAX_TRACKS_PER_USER: 30,
    RHAPSOD_AUDIO_TEST_TONE_SECONDS: 0,
    RHAPSOD_OPUS_BITRATE: 96000,
    RHAPSOD_OPUS_COMPLEXITY: 10,
    RHAPSOD_OPUS_PACKET_LOSS_PERCENT: 0,
    RHAPSOD_LOUDNESS_TARGET_LUFS: -14,
    RHAPSOD_SPOTIFY_CLIENT_ID: undefined,
    RHAPSOD_SPOTIFY_CLIENT_SECRET: undefined,
    RHAPSOD_SPOTIFY_REFRESH_TOKEN: undefined,
    RHAPSOD_TS3_CHANNEL_PASSWORD: undefined,
    RHAPSOD_TS3_CHANNEL_NAME: undefined,
    RHAPSOD_TS3_CHANNEL_ID: undefined,
    RHAPSOD_TS3_CONNECT_TIMEOUT_SECONDS: 180,
    RHAPSOD_TS3_HEARTBEAT_SECONDS: 60,
    RHAPSOD_TS3_HOST: "ts.example.com",
    RHAPSOD_TS3_NICKNAME: "Rhapsod",
    RHAPSOD_TS3_PASSWORD: undefined,
    RHAPSOD_TS3_PORT: 9987,
    RHAPSOD_TS3_AUTO_CONNECT: true,
    RHAPSOD_TS3_CLIENT_DESCRIPTION: undefined,
    RHAPSOD_YTDLP_PATH: "yt-dlp",
    RHAPSOD_YTDLP_COOKIES_PATH: undefined,
    RHAPSOD_YTDLP_EXTRACTOR_ARGS: undefined,
    RHAPSOD_YTDLP_DAEMON_URL: undefined,
    RHAPSOD_PANEL_ENABLED: true,
    RHAPSOD_PANEL_PORT: 0,
    RHAPSOD_PANEL_USER: "admin",
    RHAPSOD_PANEL_PASSWORD: "secret",
    RHAPSOD_VERBOSE: false,
    ...overrides,
  };
}

function startTestPanel(envContent: string, port: number) {
  const dir = mkdtempSync(join(tmpdir(), "panel-"));
  const envPath = join(dir, ".env");
  writeFileSync(envPath, envContent);
  const panel = createPanelServer({
    config: baseConfig({ RHAPSOD_PANEL_PORT: port }),
    envFilePath: envPath,
    logger,
    status: () => ({ connected: true, queueLength: 2, version: "2.2.0" }),
    queue: () => [],
    executeCommand: () => Promise.resolve("OK"),
    restart: () => undefined,
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  const auth = `Basic ${Buffer.from("admin:secret").toString("base64")}`;
  return { baseUrl, auth, envPath, dir, close: panel.close };
}

describe("panel-server", () => {
  it("serves health and env over HTTP with basic auth", async () => {
    const port = 23456;
    const state = startTestPanel("RHAPSOD_TS3_HOST=ts.example.com\n", port);
    try {
      const health = await fetch(`${state.baseUrl}/api/health`, {
        headers: { authorization: state.auth },
      });
      expect(health.status).toBe(200);
      const healthBody = (await health.json()) as {
        connected: boolean;
        queueLength: number;
      };
      expect(healthBody.connected).toBe(true);
      expect(healthBody.queueLength).toBe(2);

      const env = await fetch(`${state.baseUrl}/api/env`, {
        headers: { authorization: state.auth },
      });
      const envBody = (await env.json()) as {
        entries: { key: string; value: string }[];
      };
      const host = envBody.entries.find((e) => e.key === "RHAPSOD_TS3_HOST");
      expect(host?.value).toBe("ts.example.com");
    } finally {
      await state.close();
      rmSync(state.dir, { recursive: true, force: true });
    }
  });

  it("serves error summary over HTTP", async () => {
    const port = 23459;
    const dir = mkdtempSync(join(tmpdir(), "panel-"));
    const envPath = join(dir, ".env");
    writeFileSync(envPath, "");
    const panel = createPanelServer({
      config: baseConfig({ RHAPSOD_PANEL_PORT: port }),
      envFilePath: envPath,
      logger,
      status: () => ({ connected: true, queueLength: 0, version: "2.2.0" }),
      queue: () => [],
      executeCommand: () => Promise.resolve("OK"),
      restart: () => undefined,
      errors: () => ({
        totalErrors: 2,
        byCategory: { auth: 1, playback: 1 },
        recent: [
          {
            ts: 1_700_000_000_000,
            trackId: "vid1",
            trackTitle: "Song One",
            category: "auth",
            message: "sign in to confirm",
          },
        ],
      }),
    });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/errors`, {
        headers: {
          authorization: `Basic ${Buffer.from("admin:secret").toString("base64")}`,
        },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        totalErrors: number;
        byCategory: Record<string, number>;
        recent: { trackTitle?: string }[];
      };
      expect(body.totalErrors).toBe(2);
      expect(body.byCategory).toEqual({ auth: 1, playback: 1 });
      expect(body.recent[0]?.trackTitle).toBe("Song One");
    } finally {
      await panel.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("serves youtube health over HTTP", async () => {
    const port = 23561;
    const dir = mkdtempSync(join(tmpdir(), "panel-"));
    const envPath = join(dir, ".env");
    writeFileSync(envPath, "");
    const panel = createPanelServer({
      config: baseConfig({ RHAPSOD_PANEL_PORT: port }),
      envFilePath: envPath,
      logger,
      status: () => ({ connected: true, queueLength: 0, version: "2.2.0" }),
      queue: () => [],
      executeCommand: () => Promise.resolve("OK"),
      restart: () => undefined,
      youtubeHealth: () => Promise.resolve({ ok: true, ms: 123 }),
      saveCookies: (content: string) => {
        if (!content) throw new Error("vacío");
        return Promise.resolve({ path: "/tmp/c.txt" });
      },
    });
    const auth = `Basic ${Buffer.from("admin:secret").toString("base64")}`;
    // NOTE: `connection: close` works around a keep-alive quirk of the panel
    // server where the 3rd sequential request on a reused socket stalls.
    const noKeepAlive = {
      authorization: auth,
      connection: "close",
    };
    try {
      const health = await fetch(
        `http://127.0.0.1:${port}/api/youtube-health`,
        {
          headers: noKeepAlive,
        },
      );
      expect(health.status).toBe(200);
      const healthBody = (await health.json()) as { ok: boolean; ms: number };
      expect(healthBody.ok).toBe(true);
      expect(healthBody.ms).toBe(123);

      const saved = await fetch(`http://127.0.0.1:${port}/api/cookies`, {
        method: "PUT",
        headers: {
          ...noKeepAlive,
          "content-type": "application/json",
        },
        body: JSON.stringify({ content: "cookies" }),
      });
      expect(saved.status).toBe(200);
      expect(((await saved.json()) as { path: string }).path).toBe(
        "/tmp/c.txt",
      );

      const bad = await fetch(`http://127.0.0.1:${port}/api/cookies`, {
        method: "PUT",
        headers: {
          ...noKeepAlive,
          "content-type": "application/json",
        },
        body: JSON.stringify({ content: 42 }),
      });
      expect(bad.status).toBe(400);
      await bad.text();
    } finally {
      await panel.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns unavailable youtube endpoints when not configured", async () => {
    const port = 23562;
    const state = startTestPanel("", port);
    try {
      const health = await fetch(`${state.baseUrl}/api/youtube-health`, {
        headers: { authorization: state.auth },
      });
      const healthBody = (await health.json()) as { ok: boolean };
      expect(healthBody.ok).toBe(false);

      const saved = await fetch(`${state.baseUrl}/api/cookies`, {
        method: "PUT",
        headers: {
          authorization: state.auth,
          "content-type": "application/json",
        },
        body: JSON.stringify({ content: "x" }),
      });
      expect(saved.status).toBe(501);
    } finally {
      await state.close();
      rmSync(state.dir, { recursive: true, force: true });
    }
  });

  it("returns empty error summary when no provider is configured", async () => {
    const port = 23460;
    const state = startTestPanel("", port);
    try {
      const res = await fetch(`${state.baseUrl}/api/errors`, {
        headers: { authorization: state.auth },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { totalErrors: number };
      expect(body.totalErrors).toBe(0);
    } finally {
      await state.close();
      rmSync(state.dir, { recursive: true, force: true });
    }
  });

  it("rejects unauthenticated requests", async () => {
    const port = 23457;
    const state = startTestPanel("", port);
    try {
      const res = await fetch(`${state.baseUrl}/api/health`);
      expect(res.status).toBe(401);
    } finally {
      await state.close();
      rmSync(state.dir, { recursive: true, force: true });
    }
  });

  it("writes new env values via PUT", async () => {
    const port = 23458;
    const state = startTestPanel("RHAPSOD_TS3_HOST=old.example.com\n", port);
    try {
      const res = await fetch(`${state.baseUrl}/api/env`, {
        method: "PUT",
        headers: {
          authorization: state.auth,
          "content-type": "application/json",
        },
        body: JSON.stringify({ RHAPSOD_TS3_HOST: "new.example.com" }),
      });
      expect(res.status).toBe(200);
      const content = await import("node:fs").then((fs) =>
        fs.readFileSync(state.envPath, "utf8"),
      );
      expect(content).toContain("RHAPSOD_TS3_HOST=new.example.com");
    } finally {
      await state.close();
      rmSync(state.dir, { recursive: true, force: true });
    }
  });
});
