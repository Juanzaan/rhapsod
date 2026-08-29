import { basicAuth } from "hono/basic-auth";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type { Logger } from "pino";

import type { AppConfig } from "../config.js";
import { loadEnvFile, maskSecret, saveEnvFile } from "./env-file.js";

export interface PanelStatus {
  readonly connected: boolean;
  readonly currentChannelId?: number;
  readonly queueLength: number;
  readonly currentTitle?: string;
  readonly version: string;
}

export interface PanelOptions {
  readonly config: AppConfig;
  readonly envFilePath: string;
  readonly logger: Logger;
  readonly status: () => PanelStatus;
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

function describeEnvKey(key: string): string {
  const descriptions: Record<string, string> = {
    RHAPSOD_TS3_HOST: "Dirección del servidor TeamSpeak",
    RHAPSOD_TS3_PORT: "Puerto de voz de TeamSpeak (default 9987)",
    RHAPSOD_TS3_NICKNAME: "Nombre del bot en el servidor",
    RHAPSOD_TS3_PASSWORD: "Contraseña del servidor (si tiene)",
    RHAPSOD_TS3_CHANNEL_NAME: "Canal al que entrar (vacío = cualquiera)",
    RHAPSOD_TS3_CHANNEL_PASSWORD: "Contraseña del canal (si tiene)",
    RHAPSOD_ADMIN_UIDS: "UIDs de administradores (separados por coma)",
    RHAPSOD_YTDLP_PATH: "Ruta del binario yt-dlp",
    RHAPSOD_YTDLP_COOKIES_PATH: "Ruta al archivo de cookies de YouTube",
    RHAPSOD_YTDLP_DAEMON_URL: "URL del daemon yt-dlp (opcional)",
    RHAPSOD_FFMPEG_PATH: "Ruta del binario ffmpeg",
    RHAPSOD_LOUDNESS_TARGET_LUFS: "Normalización de volumen (LUFS, -30 a 0)",
    RHAPSOD_OPUS_BITRATE: "Bitrate de Opus (64000-160000)",
    RHAPSOD_SPOTIFY_CLIENT_ID: "Spotify Client ID (opcional)",
    RHAPSOD_SPOTIFY_CLIENT_SECRET: "Spotify Client Secret (opcional)",
    RHAPSOD_PANEL_USER: "Usuario del panel",
    RHAPSOD_PANEL_PASSWORD: "Contraseña del panel",
  };
  return descriptions[key] ?? "";
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

  app.get("/api/health", (c) => c.json(options.status()));

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
      return c.json({ ok: false, error: "Cuerpo inválido" }, 400);
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

  app.get("/api/status", (c) => c.json(options.status()));

  const server = serve({
    fetch: app.fetch,
    hostname: "127.0.0.1",
    port: options.config.RHAPSOD_PANEL_PORT,
  });
  options.logger.info(
    {
      port: options.config.RHAPSOD_PANEL_PORT,
      user: panelUser,
    },
    "Setup panel listening on 127.0.0.1",
  );

  return {
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
