import { basicAuth } from "hono/basic-auth";
import { gzipSync } from "node:zlib";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type { Logger } from "pino";

import type { AppConfig } from "../config.js";
import type { ChatEntry } from "../application/chat-log.js";
import type {
  DisconnectSummary,
  ErrorSummary,
} from "../observability/metrics.js";
import { COMMAND_SPECS } from "../commands/command-registry.js";
import { loadEnvFile, maskSecret, saveEnvFile } from "./env-file.js";
import {
  renderDashboard,
  renderSetupWizard,
  renderCommandsPage,
  renderServerPage,
  renderSettingsPage,
} from "./panel-templates.js";

export interface QueueEntry {
  readonly title: string;
  readonly source: string;
  readonly requestedBy?: string;
}

export interface ServerViewChannel {
  readonly cid: number;
  readonly name: string;
  readonly parentCid?: number;
}

export interface ServerViewClient {
  readonly clid: number;
  readonly name: string;
  readonly cid: number;
}

export interface ServerView {
  readonly version: number;
  readonly botChannelId: number;
  readonly channels: readonly ServerViewChannel[];
  readonly clients: readonly ServerViewClient[];
}

export interface PanelStatus {
  readonly connected: boolean;
  readonly currentChannelId?: number;
  readonly queueLength: number;
  readonly currentTitle?: string;
  readonly currentArtist?: string;
  readonly currentDuration?: number;
  readonly currentPosition?: number;
  readonly durationMs?: number;
  readonly positionMs?: number;
  readonly playerState?: "idle" | "buffering" | "playing" | "paused";
  readonly volume?: number;
  readonly loopMode?: string;
  readonly currentFilter?: string;
  readonly tracksPlayed?: number;
  readonly uptimeMs?: number;
  readonly disconnects?: DisconnectSummary;
  readonly version: string;
  readonly uptime?: number;
  readonly hostname?: string;
}

export interface PanelOptions {
  readonly config: AppConfig;
  readonly envFilePath: string;
  readonly logger: Logger;
  readonly status: () => PanelStatus;
  readonly queue: () => QueueEntry[];
  readonly chat?: () => readonly ChatEntry[];
  readonly sendChat?: (text: string) => Promise<void>;
  readonly serverView?: () => ServerView;
  readonly moveBot?: (cid: number) => Promise<void>;
  readonly errors?: () => ErrorSummary;
  readonly youtubeHealth?: () => Promise<{
    readonly ok: boolean;
    readonly ms?: number;
    readonly error?: string;
  }>;
  readonly saveCookies?: (content: string) => Promise<{ path: string }>;
  readonly executeCommand: (command: string) => Promise<string>;
  readonly restart: () => void;
  readonly testConnection?: (
    host: string,
    port: number,
  ) => Promise<{ ok: boolean; error?: string; serverName?: string }>;
}

const SECRET_KEYS = new Set([
  "RHAPSOD_TS3_PASSWORD",
  "RHAPSOD_TS3_CHANNEL_PASSWORD",
  "RHAPSOD_SPOTIFY_CLIENT_SECRET",
  "RHAPSOD_SPOTIFY_REFRESH_TOKEN",
  "RHAPSOD_PANEL_PASSWORD",
]);

const MASKED_KEYS = new Set([
  "RHAPSOD_YTDLP_COOKIES_PATH",
  "RHAPSOD_ADMIN_UIDS",
]);

const ENV_DESCRIPTIONS: Record<string, string> = {
  RHAPSOD_TS3_HOST: "Direccion del servidor TeamSpeak",
  RHAPSOD_TS3_PORT: "Puerto de voz (default 9987)",
  RHAPSOD_TS3_NICKNAME: "Nombre del bot",
  RHAPSOD_TS3_PASSWORD: "Contrasena del servidor (si tiene)",
  RHAPSOD_TS3_CHANNEL_NAME: "Canal al que entrar (vacio = default)",
  RHAPSOD_TS3_CHANNEL_ID: "ID del canal (override de CHANNEL_NAME)",
  RHAPSOD_TS3_CHANNEL_PASSWORD: "Contrasena del canal",
  RHAPSOD_TS3_AUTO_CONNECT: "Conectar automaticamente (true/false)",
  RHAPSOD_TS3_HEARTBEAT_SECONDS: "Heartbeat en segundos (0 = off)",
  RHAPSOD_TS3_CONNECT_TIMEOUT_SECONDS: "Timeout de conexion (15-300s)",
  RHAPSOD_TS3_CLIENT_DESCRIPTION: "Descripcion del bot en el servidor",
  RHAPSOD_ADMIN_UIDS: "UIDs de admin separados por coma",
  RHAPSOD_PRIVATE_COMMAND_UIDS: "UIDs con acceso a comandos privados",
  RHAPSOD_YTDLP_PATH: "Ruta del binario yt-dlp",
  RHAPSOD_YTDLP_COOKIES_PATH: "Ruta a cookies.txt de YouTube",
  RHAPSOD_YTDLP_DAEMON_URL: "URL del daemon yt-dlp (http://127.0.0.1:8765)",
  RHAPSOD_YTDLP_EXTRACTOR_ARGS: "Args extra para yt-dlp",
  RHAPSOD_WARP_PROXY: "Egress fallback para 403 (vacio = solo directo)",
  RHAPSOD_FFMPEG_PATH: "Ruta del binario ffmpeg",
  RHAPSOD_FFMPEG_USER_AGENT: "User-Agent para ffmpeg",
  RHAPSOD_FFPROBE_PATH: "Ruta del binario ffprobe",
  RHAPSOD_LOUDNESS_TARGET_LUFS:
    "Normalizacion de volumen (-30 a 0, default -14)",
  RHAPSOD_OPUS_BITRATE: "Bitrate de Opus (64000-160000)",
  RHAPSOD_OPUS_COMPLEXITY: "Complejidad de Opus (0-10)",
  RHAPSOD_OPUS_PACKET_LOSS_PERCENT: "Perdida de packets Opus (0-30)",
  RHAPSOD_SPOTIFY_CLIENT_ID: "Spotify Client ID (opcional)",
  RHAPSOD_SPOTIFY_CLIENT_SECRET: "Spotify Client Secret (opcional)",
  RHAPSOD_SPOTIFY_REFRESH_TOKEN: "Spotify Refresh Token (opcional)",
  RHAPSOD_AUDIO_TEST_TONE_SECONDS: "Tono de prueba al iniciar (0 = off)",
  RHAPSOD_LOG_LEVEL: "Nivel de log (trace/debug/info/warn/error/fatal)",
  RHAPSOD_LOG_RETENTION_DAYS: "Dias de retencion de logs (1-90)",
  RHAPSOD_METRICS_INTERVAL_MINUTES: "Intervalo de metricas (0 = off)",
  RHAPSOD_WATCHDOG_INTERVAL_MINUTES: "Intervalo de watchdog (0 = off)",
  RHAPSOD_MAX_CONCURRENT_COMMANDS: "Comandos concurrentes max (1-20)",
  RHAPSOD_MAX_CONCURRENT_YTDLP_JOBS: "Jobs yt-dlp concurrentes (1-4)",
  RHAPSOD_MAX_QUEUE_TRACKS: "Tracks max en cola (1-1000)",
  RHAPSOD_MAX_TRACKS_PER_USER: "Tracks por usuario (1-200)",
  RHAPSOD_MOVE_GROUP_IDS: "Group IDs para !move",
  RHAPSOD_MOVE_ADMIN_CHANNELS: "Channels para move admin",
  RHAPSOD_MOVE_SENIOR_CHANNELS: "Channels para move senior",
  RHAPSOD_MOVE_ADMIN_GROUP_IDS: "Group IDs admin move",
  RHAPSOD_MOVE_SENIOR_GROUP_IDS: "Group IDs senior move",
  RHAPSOD_VERBOSE: "Modo verbose (true/false)",
  RHAPSOD_PANEL_ENABLED: "Panel habilitado (true/false)",
  RHAPSOD_PANEL_PORT: "Puerto del panel (default 8080)",
  RHAPSOD_PANEL_USER: "Usuario del panel",
  RHAPSOD_PANEL_PASSWORD: "Contrasena del panel",
};

function describeEnvKey(key: string): string {
  return ENV_DESCRIPTIONS[key] ?? "";
}

function isSecret(key: string): boolean {
  return SECRET_KEYS.has(key);
}

function isMasked(key: string): boolean {
  return isSecret(key) || MASKED_KEYS.has(key);
}

export function createPanelServer(options: PanelOptions): {
  readonly close: () => Promise<void>;
} {
  const app = new Hono();
  const panelUser = options.config.RHAPSOD_PANEL_USER;
  const panelPassword = options.config.RHAPSOD_PANEL_PASSWORD;

  app.use(
    "*",
    basicAuth({
      username: panelUser,
      password: panelPassword,
    }),
  );

  // The panel is polled every few seconds at most, so keep-alive buys
  // nothing here — and reused sockets have been observed stalling responses
  // (server answers on a socket the client no longer reads). Close each
  // connection after its response to avoid the whole class of races.
  app.use("*", async (c, next) => {
    await next();
    c.header("Connection", "close");
  });

  app.get("/", (c) => {
    const status = options.status();
    const html = renderDashboard(status, panelUser, panelPassword);
    // The dashboard HTML (~22KB) is the only large response; gzip it inline.
    // (hono/compress hangs responses with this node-server version, so the
    // hot path compresses explicitly instead of via middleware.)
    const acceptEncoding = c.req.header("accept-encoding") ?? "";
    if (!/\bgzip\b/.test(acceptEncoding)) {
      return c.html(html);
    }
    const body = gzipSync(html);
    return new Response(body, {
      headers: {
        "content-type": "text/html; charset=UTF-8",
        "content-encoding": "gzip",
        "content-length": String(body.length),
      },
    });
  });

  app.get("/setup", (c) => {
    return c.html(renderSetupWizard(panelUser, panelPassword));
  });

  app.get("/settings", (c) => {
    return c.html(renderSettingsPage(panelUser, panelPassword));
  });

  app.get("/commands", (c) => {
    return c.html(renderCommandsPage(panelUser, panelPassword));
  });

  app.get("/server", (c) => {
    return c.html(renderServerPage(panelUser, panelPassword));
  });

  app.get("/api/health", (c) => c.json(options.status()));

  app.get("/api/state", (c) => {
    const status = options.status();
    const queue = options.queue();
    // Single round trip per poll: queue + errors + chat ride along with
    // status so the dashboard needs only one request per refresh interval.
    const errors =
      options.errors === undefined
        ? { totalErrors: 0, byCategory: {}, recent: [] }
        : options.errors();
    const chat = options.chat === undefined ? [] : options.chat();
    return c.json({ ...status, queue, errors, chat });
  });

  app.post("/api/chat", async (c) => {
    if (options.sendChat === undefined) {
      return c.json({ ok: false, error: "Envío no disponible" }, 501);
    }
    const body: unknown = await c.req.json().catch(() => undefined);
    const text =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>).text
        : undefined;
    if (typeof text !== "string" || text.trim().length === 0) {
      return c.json({ ok: false, error: "Mensaje vacío" }, 400);
    }
    if (text.trim().length > 500) {
      return c.json({ ok: false, error: "Mensaje demasiado largo" }, 400);
    }
    try {
      await options.sendChat(text.trim());
      return c.json({ ok: true });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "No se pudo enviar";
      return c.json({ ok: false, error: message }, 400);
    }
  });

  app.get("/api/queue", (c) => {
    return c.json({ tracks: options.queue() });
  });

  app.get("/api/server", (c) => {
    if (options.serverView === undefined) {
      return c.json({ version: 0, botChannelId: 0, channels: [], clients: [] });
    }
    return c.json(options.serverView());
  });

  app.post("/api/move", async (c) => {
    if (options.moveBot === undefined) {
      return c.json({ ok: false, error: "Movimiento no disponible" }, 501);
    }
    const body: unknown = await c.req.json().catch(() => undefined);
    const cid =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>).cid
        : undefined;
    if (typeof cid !== "number" || !Number.isSafeInteger(cid) || cid <= 0) {
      return c.json({ ok: false, error: "Canal inválido" }, 400);
    }
    try {
      await options.moveBot(cid);
      return c.json({ ok: true });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "No se pudo mover";
      return c.json({ ok: false, error: message }, 400);
    }
  });

  app.get("/api/errors", (c) => {
    if (options.errors === undefined) {
      return c.json({ totalErrors: 0, byCategory: {}, recent: [] });
    }
    return c.json(options.errors());
  });

  app.get("/api/youtube-health", async (c) => {
    if (options.youtubeHealth === undefined) {
      return c.json({ ok: false, error: "Chequeo no disponible" });
    }
    return c.json(await options.youtubeHealth());
  });

  app.put("/api/cookies", async (c) => {
    if (options.saveCookies === undefined) {
      return c.json({ ok: false, error: "Guardado no disponible" }, 501);
    }
    const body: unknown = await c.req.json().catch(() => undefined);
    if (
      typeof body !== "object" ||
      body === null ||
      typeof (body as Record<string, unknown>).content !== "string"
    ) {
      return c.json({ ok: false, error: "Contenido inválido" }, 400);
    }
    try {
      const result = await options.saveCookies(
        (body as { content: string }).content,
      );
      return c.json({ ok: true, path: result.path });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "No se pudo guardar";
      return c.json({ ok: false, error: message }, 400);
    }
  });

  app.get("/api/commands", (c) => {
    return c.json({
      commands: COMMAND_SPECS.map((spec) => ({
        name: spec.name,
        aliases: spec.aliases,
        group: spec.group,
        adminOnly: spec.adminOnly,
        usage: spec.usage,
        summary: spec.summary,
      })),
    });
  });

  app.post("/api/command", async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    if (
      typeof body !== "object" ||
      body === null ||
      typeof (body as Record<string, unknown>).command !== "string"
    ) {
      return c.json({ ok: false, error: "Comando invalido" }, 400);
    }
    const { command } = body as { command: string };
    try {
      const response = await options.executeCommand(command);
      return c.json({ ok: true, response });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Error desconocido";
      return c.json({ ok: false, error: message });
    }
  });

  app.get("/api/env", (c) => {
    const env = loadEnvFile(options.envFilePath);
    const entries = Object.entries(env.values).map(([key, value]) => ({
      key,
      description: describeEnvKey(key),
      masked: isMasked(key),
      value: isMasked(key) ? maskSecret(value) : value,
      secret: isSecret(key),
    }));
    return c.json({ entries });
  });

  app.put("/api/env", async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    if (typeof body !== "object" || body === null) {
      return c.json({ ok: false, error: "Cuerpo invalido" }, 400);
    }
    const env = loadEnvFile(options.envFilePath);
    const incoming = body as Record<string, unknown>;
    for (const [key, raw] of Object.entries(incoming)) {
      const value = typeof raw === "string" ? raw : "";
      if (value === "") {
        delete env.values[key];
      } else {
        env.values[key] = value;
      }
    }
    await saveEnvFile(options.envFilePath, env.values);
    return c.json({ ok: true });
  });

  app.post("/api/test-connection", async (c) => {
    if (!options.testConnection) {
      return c.json({ ok: false, error: "Test no disponible" }, 501);
    }
    const body: unknown = await c.req.json().catch(() => undefined);
    if (typeof body !== "object" || body === null) {
      return c.json({ ok: false, error: "Cuerpo invalido" }, 400);
    }
    const data = body as Record<string, unknown>;
    const host =
      typeof data.RHAPSOD_TS3_HOST === "string" ? data.RHAPSOD_TS3_HOST : "";
    const port =
      typeof data.RHAPSOD_TS3_PORT === "string"
        ? parseInt(data.RHAPSOD_TS3_PORT, 10)
        : 9987;
    if (!host) {
      return c.json({ ok: false, error: "Host requerido" }, 400);
    }
    try {
      return c.json(await options.testConnection(host, port));
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Error de conexion";
      return c.json({ ok: false, error: message });
    }
  });

  app.post("/api/restart", (c) => {
    options.restart();
    return c.json({ ok: true, message: "Reiniciando..." });
  });

  const panelHost = options.config.RHAPSOD_PANEL_HOST;
  const server = serve({
    fetch: app.fetch,
    hostname: panelHost,
    port: options.config.RHAPSOD_PANEL_PORT,
  });
  options.logger.info(
    {
      host: panelHost,
      port: options.config.RHAPSOD_PANEL_PORT,
      user: panelUser,
    },
    "Setup panel listening",
  );

  return {
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
