import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPanelServer } from "../src/panel/panel-server.js";
import type { Notice } from "../src/application/notices/notice.js";
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
    RHAPSOD_ENV_FILE: ".env",
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
    RHAPSOD_WATCHDOG_INTERVAL_SECONDS: 0,
    RHAPSOD_WATCHDOG_INTERVAL_MINUTES: undefined,
    RHAPSOD_MAX_CONCURRENT_COMMANDS: 3,
    RHAPSOD_MAX_CONCURRENT_YTDLP_JOBS: undefined,
    RHAPSOD_MAX_QUEUE_TRACKS: 200,
    RHAPSOD_MAX_TRACKS_PER_USER: 100,
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
    RHAPSOD_YTDLP_SEARCH_TIMEOUT_MS: 8_000,
    RHAPSOD_YTDLP_AUDIO_URL_TIMEOUT_MS: 12_000,
    RHAPSOD_YTDLP_DOWNLOAD_TIMEOUT_MS: 60_000,
    RHAPSOD_YTDLP_METADATA_TIMEOUT_MS: 30_000,
    RHAPSOD_YTDLP_PLAYLIST_TIMEOUT_MS: 45_000,
    RHAPSOD_PANEL_ENABLED: true,
    RHAPSOD_PANEL_HOST: "127.0.0.1",
    RHAPSOD_PANEL_PORT: 0,
    RHAPSOD_PANEL_USER: "admin",
    RHAPSOD_PANEL_PASSWORD: "secret",
    RHAPSOD_VERBOSE: false,
    RHAPSOD_VOTE_SKIP: false,
    RHAPSOD_SKIP_NON_MUSIC: false,
    ...overrides,
  };
}

function startTestPanel(
  envContent: string,
  port: number,
  extra: Partial<Parameters<typeof createPanelServer>[0]> = {},
) {
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
    ...extra,
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  const auth = `Basic ${Buffer.from("admin:secret").toString("base64")}`;
  return { baseUrl, auth, envPath, dir, close: panel.close };
}

describe("panel-server", () => {
  it("answers /api/health with 503 while the bot reconnects", async () => {
    let reconnecting = true;
    const state = startTestPanel("", 23615, {
      status: () => ({
        connected: !reconnecting,
        queueLength: 0,
        reconnecting,
        version: "4.0.0",
      }),
    });
    try {
      const down = await fetch(`${state.baseUrl}/api/health`, {
        headers: { authorization: state.auth },
      });
      expect(down.status).toBe(503);
      expect(
        ((await down.json()) as { reconnecting: boolean }).reconnecting,
      ).toBe(true);
      reconnecting = false;
      const up = await fetch(`${state.baseUrl}/api/health`, {
        headers: { authorization: state.auth },
      });
      expect(up.status).toBe(200);
    } finally {
      await state.close();
      rmSync(state.dir, { force: true, recursive: true });
    }
  });

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
    // NOTE: several sequential fetches on purpose — the server closes each
    // connection (see panel-server) so pooled-socket stalls can't happen.
    const headers = { authorization: auth };
    try {
      const health = await fetch(
        `http://127.0.0.1:${port}/api/youtube-health`,
        {
          headers,
        },
      );
      expect(health.status).toBe(200);
      const healthBody = (await health.json()) as { ok: boolean; ms: number };
      expect(healthBody.ok).toBe(true);
      expect(healthBody.ms).toBe(123);

      const saved = await fetch(`http://127.0.0.1:${port}/api/cookies`, {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ content: "cookies" }),
      });
      expect(saved.status).toBe(200);
      expect(((await saved.json()) as { path: string }).path).toBe(
        "/tmp/c.txt",
      );

      const bad = await fetch(`http://127.0.0.1:${port}/api/cookies`, {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ content: 42 }),
      });
      expect(bad.status).toBe(400);
      await bad.text();

      const again = await fetch(`http://127.0.0.1:${port}/api/health`, {
        headers,
      });
      expect(again.status).toBe(200);
      await again.text();
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

  it("serves an SVG favicon instead of a 404", async () => {
    const port = 23611;
    const state = startTestPanel("", port);
    try {
      const res = await fetch(`${state.baseUrl}/favicon.ico`, {
        headers: { authorization: state.auth },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("image/svg+xml");
      expect(await res.text()).toContain("<svg");
    } finally {
      await state.close();
      rmSync(state.dir, { recursive: true, force: true });
    }
  });

  it("serves the self-hosted fonts with a cache window and nothing else", async () => {
    const state = startTestPanel("", 23651);
    try {
      const res = await fetch(`${state.baseUrl}/fonts/instrument-sans.woff2`, {
        headers: { authorization: state.auth },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("font/woff2");
      expect(res.headers.get("cache-control")).toBe("private, max-age=604800");
      expect(res.headers.get("content-security-policy")).toContain(
        "font-src 'self'",
      );
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("wOF2");

      const page = await fetch(`${state.baseUrl}/`, {
        headers: { authorization: state.auth },
      });
      expect(page.headers.get("cache-control")).toBe("no-store");

      for (const name of ["../package.json", "other.woff2", "%2e%2e%2fx"]) {
        const miss = await fetch(`${state.baseUrl}/fonts/${name}`, {
          headers: { authorization: state.auth },
        });
        expect(miss.status).toBe(404);
      }
      const anon = await fetch(`${state.baseUrl}/fonts/bricolage.woff2`);
      expect(anon.status).toBe(401);
    } finally {
      await state.close();
      rmSync(state.dir, { recursive: true, force: true });
    }
  });

  it("serves the dashboard with a content-length matching the body", async () => {
    // Regression: the dashboard used to be gzipped inline with content-length
    // taken from the gzip buffer, while the runtime wrote the uncompressed
    // bytes. Browsers read content-length bytes, considered the response done,
    // and hung forever waiting on the rest — re-prompting for basic auth on
    // each retry. Any content-length must describe the bytes actually sent.
    const port = 23563;
    const state = startTestPanel("", port);
    try {
      const res = await fetch(`${state.baseUrl}/`, {
        headers: {
          authorization: state.auth,
          "accept-encoding": "gzip",
        },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");

      const bytes = (await res.arrayBuffer()).byteLength;
      const declared = res.headers.get("content-length");
      if (declared !== null) {
        expect(Number(declared)).toBe(bytes);
      }
    } finally {
      await state.close();
      rmSync(state.dir, { recursive: true, force: true });
    }
  });

  it("still renders the dashboard when the client accepts gzip", async () => {
    const port = 23573;
    const state = startTestPanel("", port);
    try {
      const res = await fetch(`${state.baseUrl}/`, {
        headers: {
          authorization: state.auth,
          "accept-encoding": "gzip, deflate, br",
        },
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("RHAPSOD");
    } finally {
      await state.close();
      rmSync(state.dir, { recursive: true, force: true });
    }
  });

  it("includes queue and errors in /api/state", async () => {
    const port = 23564;
    const dir = mkdtempSync(join(tmpdir(), "panel-"));
    const envPath = join(dir, ".env");
    writeFileSync(envPath, "");
    const panel = createPanelServer({
      config: baseConfig({ RHAPSOD_PANEL_PORT: port }),
      envFilePath: envPath,
      logger,
      status: () => ({ connected: true, queueLength: 1, version: "2.2.0" }),
      queue: () => [{ title: "Song", source: "youtube" }],
      executeCommand: () => Promise.resolve("OK"),
      restart: () => undefined,
      errors: () => ({
        totalErrors: 1,
        byCategory: { playback: 1 },
        recent: [],
      }),
    });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/state`, {
        headers: {
          authorization: `Basic ${Buffer.from("admin:secret").toString("base64")}`,
        },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        queue: { title: string }[];
        errors: { totalErrors: number };
      };
      expect(body.queue).toHaveLength(1);
      expect(body.errors.totalErrors).toBe(1);
    } finally {
      await panel.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("proxies test-connection to the injected probe", async () => {
    const port = 23565;
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
      testConnection: (host: string) =>
        Promise.resolve(
          host === "good.example.com"
            ? { ok: true, serverName: "Good Server" }
            : { ok: false, error: "unreachable" },
        ),
    });
    const auth = `Basic ${Buffer.from("admin:secret").toString("base64")}`;
    try {
      const good = await fetch(`http://127.0.0.1:${port}/api/test-connection`, {
        method: "POST",
        headers: { authorization: auth, "content-type": "application/json" },
        body: JSON.stringify({ RHAPSOD_TS3_HOST: "good.example.com" }),
      });
      expect(good.status).toBe(200);
      expect(((await good.json()) as { serverName: string }).serverName).toBe(
        "Good Server",
      );

      const bad = await fetch(`http://127.0.0.1:${port}/api/test-connection`, {
        method: "POST",
        headers: { authorization: auth, "content-type": "application/json" },
        body: JSON.stringify({ RHAPSOD_TS3_HOST: "bad.example.com" }),
      });
      expect(((await bad.json()) as { ok: boolean }).ok).toBe(false);
    } finally {
      await panel.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sends chat through the injected sender", async () => {
    const port = 23566;
    const dir = mkdtempSync(join(tmpdir(), "panel-"));
    const envPath = join(dir, ".env");
    writeFileSync(envPath, "");
    const sent: string[] = [];
    const panel = createPanelServer({
      config: baseConfig({ RHAPSOD_PANEL_PORT: port }),
      envFilePath: envPath,
      logger,
      status: () => ({ connected: true, queueLength: 0, version: "2.2.0" }),
      queue: () => [],
      executeCommand: () => Promise.resolve("OK"),
      restart: () => undefined,
      chat: () => [
        { ts: 1_700_000_000_000, from: "Ana", text: "hola", outgoing: false },
      ],
      sendChat: (text: string) => {
        sent.push(text);
        return Promise.resolve();
      },
    });
    const auth = `Basic ${Buffer.from("admin:secret").toString("base64")}`;
    try {
      const state = await fetch(`http://127.0.0.1:${port}/api/state`, {
        headers: { authorization: auth },
      });
      const stateBody = (await state.json()) as {
        chat: { from: string }[];
      };
      expect(stateBody.chat).toHaveLength(1);
      expect(stateBody.chat[0]?.from).toBe("Ana");

      const ok = await fetch(`http://127.0.0.1:${port}/api/chat`, {
        method: "POST",
        headers: { authorization: auth, "content-type": "application/json" },
        body: JSON.stringify({ text: "  hola a todos  " }),
      });
      expect(ok.status).toBe(200);
      expect(sent).toEqual(["hola a todos"]);
      await ok.text();

      const empty = await fetch(`http://127.0.0.1:${port}/api/chat`, {
        method: "POST",
        headers: { authorization: auth, "content-type": "application/json" },
        body: JSON.stringify({ text: "   " }),
      });
      expect(empty.status).toBe(400);
      await empty.text();

      const long = await fetch(`http://127.0.0.1:${port}/api/chat`, {
        method: "POST",
        headers: { authorization: auth, "content-type": "application/json" },
        body: JSON.stringify({ text: "x".repeat(501) }),
      });
      expect(long.status).toBe(400);
      await long.text();
    } finally {
      await panel.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("serves server view, events and move", async () => {
    const port = 23567;
    const dir = mkdtempSync(join(tmpdir(), "panel-"));
    const envPath = join(dir, ".env");
    writeFileSync(envPath, "");
    const moved: number[] = [];
    const panel = createPanelServer({
      config: baseConfig({ RHAPSOD_PANEL_PORT: port }),
      envFilePath: envPath,
      logger,
      status: () => ({ connected: true, queueLength: 0, version: "2.2.0" }),
      queue: () => [],
      executeCommand: () => Promise.resolve("OK"),
      restart: () => undefined,
      serverView: () => ({
        version: 3,
        botChannelId: 2,
        channels: [
          { cid: 1, name: "Lobby" },
          { cid: 2, name: "Music", parentCid: 1 },
        ],
        clients: [{ clid: 5, name: "Ana", cid: 2 }],
      }),
      moveBot: (cid: number) => {
        moved.push(cid);
        return Promise.resolve();
      },
    });
    const auth = `Basic ${Buffer.from("admin:secret").toString("base64")}`;
    try {
      const view = await fetch(`http://127.0.0.1:${port}/api/server`, {
        headers: { authorization: auth },
      });
      expect(view.status).toBe(200);
      const viewBody = (await view.json()) as {
        botChannelId: number;
        channels: unknown[];
      };
      expect(viewBody.botChannelId).toBe(2);
      expect(viewBody.channels).toHaveLength(2);

      const move = await fetch(`http://127.0.0.1:${port}/api/move`, {
        method: "POST",
        headers: { authorization: auth, "content-type": "application/json" },
        body: JSON.stringify({ cid: 2 }),
      });
      expect(move.status).toBe(200);
      expect(moved).toEqual([2]);
      await move.text();

      const bad = await fetch(`http://127.0.0.1:${port}/api/move`, {
        method: "POST",
        headers: { authorization: auth, "content-type": "application/json" },
        body: JSON.stringify({ cid: -1 }),
      });
      expect(bad.status).toBe(400);
      await bad.text();
    } finally {
      await panel.close();
      rmSync(dir, { recursive: true, force: true });
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

  it("rejects PUTs of unknown env keys", async () => {
    // The env file feeds the whole process, so an unrestricted write would
    // let the panel set arbitrary variables. Only known RHAPSOD_* keys pass.
    const port = 23459;
    const state = startTestPanel("RHAPSOD_TS3_HOST=keep.example.com\n", port);
    try {
      const res = await fetch(`${state.baseUrl}/api/env`, {
        method: "PUT",
        headers: {
          authorization: state.auth,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          RHAPSOD_TS3_HOST: "changed.example.com",
          PATH: "/usr/bin:.",
          RHAPSOD_MADE_UP_KEY: "whatever",
        }),
      });
      expect(res.status).toBe(400);
      const payload = (await res.json()) as { error?: string };
      expect(payload.error).toContain("RHAPSOD_MADE_UP_KEY");
      expect(payload.error).toContain("PATH");
      const content = await import("node:fs").then((fs) =>
        fs.readFileSync(state.envPath, "utf8"),
      );
      expect(content).toContain("RHAPSOD_TS3_HOST=keep.example.com");
      expect(content).not.toContain("changed.example.com");
    } finally {
      await state.close();
      rmSync(state.dir, { recursive: true, force: true });
    }
  });

  it("saves around the read-only panel host instead of rejecting it", async () => {
    // Regression: RHAPSOD_PANEL_HOST lived in .env.example without a panel
    // description, so every save from a copied example failed with an
    // unknown-key 400 and looked like saving was broken.
    const port = 23463;
    const state = startTestPanel(
      "RHAPSOD_TS3_HOST=old.example.com\nRHAPSOD_PANEL_HOST=127.0.0.1\n",
      port,
    );
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
      expect(content).toContain("RHAPSOD_PANEL_HOST=127.0.0.1");
    } finally {
      await state.close();
      rmSync(state.dir, { recursive: true, force: true });
    }
  });

  it("saves yt-dlp timeouts in range and rejects the rest", async () => {
    // Regression: the timeouts were read straight from process.env, so the
    // panel had no description for them and refused every save as unknown.
    const port = 23612;
    const state = startTestPanel("RHAPSOD_TS3_HOST=ts.example.com\n", port);
    const put = (body: Record<string, string>) =>
      fetch(`${state.baseUrl}/api/env`, {
        method: "PUT",
        headers: {
          authorization: state.auth,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    try {
      const saved = await put({ RHAPSOD_YTDLP_AUDIO_URL_TIMEOUT_MS: "20000" });
      expect(saved.status).toBe(200);
      const rejected = await put({ RHAPSOD_YTDLP_SEARCH_TIMEOUT_MS: "1000" });
      expect(rejected.status).toBe(400);
      const content = await import("node:fs").then((fs) =>
        fs.readFileSync(state.envPath, "utf8"),
      );
      expect(content).toContain("RHAPSOD_YTDLP_AUDIO_URL_TIMEOUT_MS=20000");
      expect(content).not.toContain("RHAPSOD_YTDLP_SEARCH_TIMEOUT_MS");
    } finally {
      await state.close();
      rmSync(state.dir, { recursive: true, force: true });
    }
  });

  it("pauses before answering a wrong password, not a missing one", async () => {
    const port = 23616;
    const state = startTestPanel("", port, { failedLoginDelayMs: 400 });
    try {
      let started = Date.now();
      const anonymous = await fetch(`${state.baseUrl}/api/health`);
      expect(anonymous.status).toBe(401);
      expect(Date.now() - started).toBeLessThan(400);

      started = Date.now();
      const wrong = await fetch(`${state.baseUrl}/api/health`, {
        headers: {
          authorization: `Basic ${Buffer.from("admin:nope").toString("base64")}`,
        },
      });
      expect(wrong.status).toBe(401);
      expect(Date.now() - started).toBeGreaterThanOrEqual(380);

      const ok = await fetch(`${state.baseUrl}/api/health`, {
        headers: { authorization: state.auth },
      });
      expect(ok.status).toBe(200);
    } finally {
      await state.close();
      rmSync(state.dir, { recursive: true, force: true });
    }
  });

  it("serves Prometheus metrics behind the panel auth", async () => {
    const port = 23613;
    const state = startTestPanel("RHAPSOD_TS3_HOST=ts.example.com\n", port, {
      metricsText: () => "rhapsod_uptime_seconds 5\n",
    });
    try {
      const anonymous = await fetch(`${state.baseUrl}/api/metrics`);
      expect(anonymous.status).toBe(401);
      const res = await fetch(`${state.baseUrl}/api/metrics`, {
        headers: { authorization: state.auth },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("version=0.0.4");
      expect(await res.text()).toBe("rhapsod_uptime_seconds 5\n");
    } finally {
      await state.close();
      rmSync(state.dir, { recursive: true, force: true });
    }
  });

  it("answers 404 for metrics when none are wired", async () => {
    const port = 23614;
    const state = startTestPanel("RHAPSOD_TS3_HOST=ts.example.com\n", port);
    try {
      const res = await fetch(`${state.baseUrl}/api/metrics`, {
        headers: { authorization: state.auth },
      });
      expect(res.status).toBe(404);
    } finally {
      await state.close();
      rmSync(state.dir, { recursive: true, force: true });
    }
  });

  it("rejects writes to read-only env keys", async () => {
    const port = 23464;
    const state = startTestPanel("RHAPSOD_PANEL_HOST=127.0.0.1\n", port);
    try {
      const res = await fetch(`${state.baseUrl}/api/env`, {
        method: "PUT",
        headers: {
          authorization: state.auth,
          "content-type": "application/json",
        },
        body: JSON.stringify({ RHAPSOD_PANEL_HOST: "0.0.0.0" }),
      });
      expect(res.status).toBe(400);
      const payload = (await res.json()) as { error?: string };
      expect(payload.error).toContain("RHAPSOD_PANEL_HOST");
      const content = await import("node:fs").then((fs) =>
        fs.readFileSync(state.envPath, "utf8"),
      );
      expect(content).toContain("RHAPSOD_PANEL_HOST=127.0.0.1");
    } finally {
      await state.close();
      rmSync(state.dir, { recursive: true, force: true });
    }
  });

  it("marks entries editable in the env listing", async () => {
    const port = 23465;
    const state = startTestPanel(
      "RHAPSOD_TS3_HOST=ts.example.com\nRHAPSOD_PANEL_HOST=127.0.0.1\n",
      port,
    );
    try {
      const res = await fetch(`${state.baseUrl}/api/env`, {
        headers: { authorization: state.auth },
      });
      const body = (await res.json()) as {
        entries: { editable: boolean; key: string }[];
      };
      expect(
        body.entries.find((e) => e.key === "RHAPSOD_TS3_HOST")?.editable,
      ).toBe(true);
      expect(
        body.entries.find((e) => e.key === "RHAPSOD_PANEL_HOST")?.editable,
      ).toBe(false);
    } finally {
      await state.close();
      rmSync(state.dir, { recursive: true, force: true });
    }
  });

  it("sets security headers on every response", async () => {
    const port = 23460;
    const state = startTestPanel("", port);
    try {
      for (const path of ["/", "/api/state"]) {
        const res = await fetch(`${state.baseUrl}${path}`, {
          headers: { authorization: state.auth },
        });
        expect(res.headers.get("x-frame-options")).toBe("DENY");
        expect(res.headers.get("x-content-type-options")).toBe("nosniff");
        expect(res.headers.get("referrer-policy")).toBe("no-referrer");
        expect(res.headers.get("cache-control")).toBe("no-store");
        const csp = res.headers.get("content-security-policy") ?? "";
        expect(csp).toContain("frame-ancestors 'none'");
        expect(csp).toContain("default-src 'none'");
        await res.text();
      }
    } finally {
      await state.close();
      rmSync(state.dir, { recursive: true, force: true });
    }
  });
});

describe("panel-server write protection", () => {
  const auth = `Basic ${Buffer.from("admin:secret").toString("base64")}`;

  function startSpyPanel(port: number, envContent = "") {
    const dir = mkdtempSync(join(tmpdir(), "panel-"));
    const envPath = join(dir, ".env");
    writeFileSync(envPath, envContent);
    const commands: string[] = [];
    let restarts = 0;
    const panel = createPanelServer({
      config: baseConfig({ RHAPSOD_PANEL_PORT: port }),
      envFilePath: envPath,
      logger,
      status: () => ({ connected: true, queueLength: 0, version: "3.0.0" }),
      queue: () => [],
      executeCommand: (command) => {
        commands.push(command);
        return Promise.resolve("OK");
      },
      restart: () => {
        restarts++;
      },
    });
    return {
      baseUrl: `http://127.0.0.1:${port}`,
      envPath,
      commands,
      restarts: () => restarts,
      cleanup: async () => {
        await panel.close();
        rmSync(dir, { recursive: true, force: true });
      },
    };
  }

  it("rejects a cross-site text/plain form post to /api/command", async () => {
    const state = startSpyPanel(23470);
    try {
      const res = await fetch(`${state.baseUrl}/api/command`, {
        method: "POST",
        headers: {
          authorization: auth,
          "content-type": "text/plain",
          origin: "https://evil.example",
          "sec-fetch-site": "cross-site",
        },
        body: '{"command":"!stop","x":"="}',
      });
      expect(res.status).toBe(403);
      expect(state.commands).toEqual([]);
    } finally {
      await state.cleanup();
    }
  });

  it("rejects JSON writes from another origin", async () => {
    const state = startSpyPanel(23471);
    try {
      const res = await fetch(`${state.baseUrl}/api/restart`, {
        method: "POST",
        headers: {
          authorization: auth,
          "content-type": "application/json",
          origin: "https://evil.example",
        },
      });
      expect(res.status).toBe(403);
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(state.restarts()).toBe(0);
    } finally {
      await state.cleanup();
    }
  });

  it("answers a same-origin restart before restarting", async () => {
    const state = startSpyPanel(23472);
    try {
      const res = await fetch(`${state.baseUrl}/api/restart`, {
        method: "POST",
        headers: {
          authorization: auth,
          "content-type": "application/json",
          origin: state.baseUrl,
          "sec-fetch-site": "same-origin",
        },
      });
      expect(res.status).toBe(200);
      expect(state.restarts()).toBe(0);
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(state.restarts()).toBe(1);
    } finally {
      await state.cleanup();
    }
  });

  it("rejects env values with line breaks and leaves the file untouched", async () => {
    const state = startSpyPanel(23473, "RHAPSOD_TS3_NICKNAME=Rhapsod\n");
    try {
      const res = await fetch(`${state.baseUrl}/api/env`, {
        method: "PUT",
        headers: { authorization: auth, "content-type": "application/json" },
        body: JSON.stringify({
          RHAPSOD_TS3_NICKNAME: "Bot\nNODE_OPTIONS=--require /tmp/x.js",
        }),
      });
      expect(res.status).toBe(400);
      expect(readFileSync(state.envPath, "utf8")).toBe(
        "RHAPSOD_TS3_NICKNAME=Rhapsod\n",
      );
    } finally {
      await state.cleanup();
    }
  });

  it("rejects values startup would refuse instead of saving a crash loop", async () => {
    const state = startSpyPanel(23474, "RHAPSOD_OPUS_BITRATE=128000\n");
    try {
      const res = await fetch(`${state.baseUrl}/api/env`, {
        method: "PUT",
        headers: { authorization: auth, "content-type": "application/json" },
        body: JSON.stringify({ RHAPSOD_OPUS_BITRATE: "abc" }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { ok: boolean; error: string };
      expect(body.error).toContain("RHAPSOD_OPUS_BITRATE");
      expect(readFileSync(state.envPath, "utf8")).toContain(
        "RHAPSOD_OPUS_BITRATE=128000",
      );
    } finally {
      await state.cleanup();
    }
  });

  it("keeps binary paths read-only", async () => {
    const state = startSpyPanel(23475);
    try {
      const res = await fetch(`${state.baseUrl}/api/env`, {
        method: "PUT",
        headers: { authorization: auth, "content-type": "application/json" },
        body: JSON.stringify({ RHAPSOD_FFMPEG_PATH: "/tmp/evil" }),
      });
      expect(res.status).toBe(400);
    } finally {
      await state.cleanup();
    }
  });

  it("does not start with a published default password", async () => {
    const errors: string[] = [];
    const panel = createPanelServer({
      config: baseConfig({
        RHAPSOD_PANEL_PORT: 23476,
        RHAPSOD_PANEL_PASSWORD: "change-me",
      }),
      envFilePath: join(tmpdir(), "unused.env"),
      logger: {
        info: noop,
        warn: noop,
        debug: noop,
        error: (msg: string) => errors.push(msg),
      } as never,
      status: () => ({ connected: true, queueLength: 0, version: "3.0.0" }),
      queue: () => [],
      executeCommand: () => Promise.resolve("OK"),
      restart: () => undefined,
    });
    try {
      await expect(
        fetch("http://127.0.0.1:23476/api/health"),
      ).rejects.toThrow();
      expect(errors.join(" ")).toContain("RHAPSOD_PANEL_PASSWORD");
    } finally {
      await panel.close();
    }
  });
});

describe("panel-server notices", () => {
  const notice: Notice = {
    key: "ts3.no-talk-power",
    detector: "ts3.no-talk-power",
    severity: "error",
    titleEs: "El bot no puede hablar",
    detailEs: "Darle talk power al bot en el canal.",
    data: { channelId: 8 },
    state: "open",
    persistent: false,
    flapping: false,
    firstSeen: 1_700_000_000_000,
    lastSeen: 1_700_000_060_000,
    occurrences: 3,
  };
  const json = (auth: string) => ({
    authorization: auth,
    "content-type": "application/json",
  });

  it("lists open notices in /api/state without their hidden data", async () => {
    const state = startTestPanel("", 23616, {
      notices: {
        list: () => [notice],
        ignore: () => true,
        verdict: () => "degraded" as const,
      },
    });
    try {
      const res = await fetch(`${state.baseUrl}/api/state`, {
        headers: { authorization: state.auth },
      });
      const body = (await res.json()) as { notices: unknown[] };
      expect(body.notices).toEqual([
        {
          key: "ts3.no-talk-power",
          severity: "error",
          title: "El bot no puede hablar",
          detail: "Darle talk power al bot en el canal.",
          ignored: false,
          since: 1_700_000_000_000,
          count: 3,
        },
      ]);
    } finally {
      await state.close();
      rmSync(state.dir, { recursive: true, force: true });
    }
  });

  it("reports the notice verdict in /api/health without failing it", async () => {
    const ignoredNotice: Notice = {
      ...notice,
      key: "disk.data-low",
      detector: "disk.data-low",
      severity: "warning",
      state: "ignored",
    };
    const state = startTestPanel("", 23620, {
      notices: {
        list: () => [notice, ignoredNotice],
        ignore: () => true,
        verdict: () => "unhealthy" as const,
      },
    });
    try {
      const res = await fetch(`${state.baseUrl}/api/health`, {
        headers: { authorization: state.auth },
      });
      // deploy.sh rolls back on any non-200 answer.
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        verdict: string;
        openNotices: number;
      };
      expect(body.verdict).toBe("unhealthy");
      expect(body.openNotices).toBe(1);
    } finally {
      await state.close();
      rmSync(state.dir, { recursive: true, force: true });
    }
  });

  it("ignores an open notice and rejects bad or stale keys", async () => {
    const ignored: string[] = [];
    const state = startTestPanel("", 23617, {
      notices: {
        list: () => [notice],
        verdict: () => "degraded" as const,
        ignore: (key) => {
          if (key !== notice.key) return false;
          ignored.push(key);
          return true;
        },
      },
    });
    const post = (body: unknown) =>
      fetch(`${state.baseUrl}/api/notices/ignore`, {
        method: "POST",
        headers: json(state.auth),
        body: JSON.stringify(body),
      });
    try {
      expect((await post({ key: notice.key })).status).toBe(200);
      expect(ignored).toEqual([notice.key]);
      expect((await post({ key: "disk.data-low" })).status).toBe(404);
      expect((await post({ key: "" })).status).toBe(400);
      expect((await post({ key: "x".repeat(201) })).status).toBe(400);
      expect((await post({})).status).toBe(400);
      expect(ignored).toEqual([notice.key]);
    } finally {
      await state.close();
      rmSync(state.dir, { recursive: true, force: true });
    }
  });

  it("answers 501 and an empty list without a notice registry", async () => {
    const state = startTestPanel("", 23618);
    try {
      const res = await fetch(`${state.baseUrl}/api/notices/ignore`, {
        method: "POST",
        headers: json(state.auth),
        body: JSON.stringify({ key: notice.key }),
      });
      expect(res.status).toBe(501);
      const st = await fetch(`${state.baseUrl}/api/state`, {
        headers: { authorization: state.auth },
      });
      expect(((await st.json()) as { notices: unknown[] }).notices).toEqual([]);
    } finally {
      await state.close();
      rmSync(state.dir, { recursive: true, force: true });
    }
  });

  it("refuses a cross-site ignore", async () => {
    const ignored: string[] = [];
    const state = startTestPanel("", 23619, {
      notices: {
        list: () => [notice],
        verdict: () => "degraded" as const,
        ignore: (key) => {
          ignored.push(key);
          return true;
        },
      },
    });
    try {
      const res = await fetch(`${state.baseUrl}/api/notices/ignore`, {
        method: "POST",
        headers: { ...json(state.auth), origin: "https://evil.example" },
        body: JSON.stringify({ key: notice.key }),
      });
      expect(res.status).toBe(403);
      expect(ignored).toEqual([]);
    } finally {
      await state.close();
      rmSync(state.dir, { recursive: true, force: true });
    }
  });
});
