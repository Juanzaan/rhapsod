import { basicAuth } from "hono/basic-auth";
import { Hono } from "hono";
import { timingSafeEqual } from "hono/utils/buffer";
import { serve } from "@hono/node-server";
import type { Logger } from "pino";

import { validateConfig, type AppConfig } from "../config.js";
import type { ChatEntry } from "../application/chat-log.js";
import type {
  HealthVerdict,
  Notice,
  NoticeSeverity,
} from "../application/notices/notice.js";
import type {
  DisconnectSummary,
  ErrorSummary,
} from "../observability/metrics.js";
import { COMMAND_SPECS } from "../commands/command-registry.js";
import type { DaemonHealthSnapshot } from "../media/youtube/daemon-health.js";
import {
  isSafeEnvValue,
  loadEnvFile,
  maskSecret,
  saveEnvFile,
} from "./env-file.js";
import { FAVICON_SVG } from "./dashboard-design.js";
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
  // TeamSpeak channel_order: the cid below which this channel sorts
  // (0 first). The tree resolves it as a chain, never a position number.
  readonly order?: number;
}

export interface ServerViewClient {
  readonly clid: number;
  readonly name: string;
  readonly cid: number;
}

export interface ServerView {
  readonly version: number;
  readonly botChannelId: number;
  readonly mode?: "full" | "partial";
  readonly channels: readonly ServerViewChannel[];
  readonly clients: readonly ServerViewClient[];
}

/** What the dashboard shows of a notice; detector data stays server-side. */
export interface PanelNotice {
  readonly key: string;
  readonly severity: NoticeSeverity;
  readonly title: string;
  readonly detail: string;
  readonly ignored: boolean;
  readonly since: number;
  readonly count: number;
}

export function toPanelNotice(notice: Notice): PanelNotice {
  return {
    key: notice.key,
    severity: notice.severity,
    title: notice.titleEs,
    detail: notice.detailEs,
    ignored: notice.state === "ignored",
    since: notice.firstSeen,
    count: notice.occurrences,
  };
}

export interface PanelStatus {
  readonly connected: boolean;
  readonly currentChannelId?: number;
  readonly queueLength: number;
  readonly currentTitle?: string;
  readonly currentArtist?: string;
  readonly durationMs?: number;
  readonly positionMs?: number;
  readonly playerState?: "idle" | "buffering" | "playing" | "paused";
  readonly volume?: number;
  readonly loopMode?: string;
  readonly tracksPlayed?: number;
  readonly uptimeMs?: number;
  readonly disconnects?: DisconnectSummary;
  /** True while the TeamSpeak connection is being re-established. */
  readonly reconnecting?: boolean;
  readonly youtubeAuthHealthy?: boolean;
  readonly ytdlpDaemon?: DaemonHealthSnapshot;
  readonly version: string;
}

/** Body of GET /api/health: the status plus the notice verdict. */
export interface PanelHealth extends PanelStatus {
  readonly verdict?: HealthVerdict;
  /** Open notices the owner has not ignored. */
  readonly openNotices?: number;
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
  /** Open notices from the registry; ignoring one hides it until it worsens. */
  readonly notices?: {
    list(): readonly Notice[];
    ignore(key: string): boolean;
    verdict(): HealthVerdict;
  };
  /** Prometheus text for GET /api/metrics; the route 404s without it. */
  readonly metricsText?: () => string;
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
  /** Pause before answering a wrong password; tests shorten it. */
  readonly failedLoginDelayMs?: number;
}

const FAILED_LOGIN_DELAY_MS = 1_000;

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
  RHAPSOD_TS3_HOST: "Dirección del servidor TeamSpeak",
  RHAPSOD_TS3_PORT: "Puerto de voz (default 9987)",
  RHAPSOD_TS3_NICKNAME: "Nombre del bot",
  RHAPSOD_TS3_PASSWORD: "Contraseña del servidor (si tiene)",
  RHAPSOD_TS3_CHANNEL_NAME: "Canal al que entrar (vacío = default)",
  RHAPSOD_TS3_CHANNEL_ID: "ID del canal (override de CHANNEL_NAME)",
  RHAPSOD_TS3_CHANNEL_PASSWORD: "Contraseña del canal",
  RHAPSOD_TS3_AUTO_CONNECT: "Conectar automáticamente (true/false)",
  RHAPSOD_TS3_HEARTBEAT_SECONDS: "Heartbeat en segundos (0 = off)",
  RHAPSOD_TS3_CONNECT_TIMEOUT_SECONDS: "Timeout de conexión (15-300s)",
  RHAPSOD_TS3_CLIENT_DESCRIPTION: "Descripción del bot en el servidor",
  RHAPSOD_ADMIN_UIDS: "UIDs de admin separados por coma",
  RHAPSOD_DATA_DIR: "Directorio de datos (identidad TS3, estado)",
  RHAPSOD_INSTANCE_ID:
    "ID de instancia (vacío = única; datos en instances/<id>)",
  RHAPSOD_ENV_FILE: "Ruta del archivo .env (solo desde el entorno real)",
  RHAPSOD_PRIVATE_COMMAND_UIDS: "UIDs con acceso a comandos privados",
  RHAPSOD_YTDLP_PATH: "Ruta del binario yt-dlp (solo lectura)",
  RHAPSOD_YTDLP_COOKIES_PATH: "Ruta a cookies.txt de YouTube",
  RHAPSOD_YTDLP_DAEMON_URL: "URL del daemon yt-dlp (http://127.0.0.1:8765)",
  RHAPSOD_YTDLP_EXTRACTOR_ARGS: "Args extra para yt-dlp",
  RHAPSOD_YTDLP_SEARCH_TIMEOUT_MS: "Timeout de búsqueda yt-dlp (4000-20000 ms)",
  RHAPSOD_YTDLP_AUDIO_URL_TIMEOUT_MS:
    "Timeout de URL de audio yt-dlp (5000-30000 ms)",
  RHAPSOD_YTDLP_DOWNLOAD_TIMEOUT_MS:
    "Timeout de descarga yt-dlp (30000-300000 ms)",
  RHAPSOD_YTDLP_METADATA_TIMEOUT_MS:
    "Timeout de metadatos yt-dlp (10000-60000 ms)",
  RHAPSOD_YTDLP_PLAYLIST_TIMEOUT_MS:
    "Timeout de playlists yt-dlp (15000-120000 ms)",
  RHAPSOD_WARP_PROXY: "Egress fallback para 403 (vacío = solo directo)",
  RHAPSOD_FFMPEG_PATH: "Ruta del binario ffmpeg (solo lectura)",
  RHAPSOD_FFMPEG_USER_AGENT: "User-Agent para ffmpeg",
  RHAPSOD_FFPROBE_PATH: "Ruta del binario ffprobe (solo lectura)",
  RHAPSOD_LOUDNESS_TARGET_LUFS:
    "Normalización de volumen (-30 a 0, default -14)",
  RHAPSOD_OPUS_BITRATE: "Bitrate de Opus (64000-160000)",
  RHAPSOD_OPUS_COMPLEXITY: "Complejidad de Opus (0-10)",
  RHAPSOD_OPUS_PACKET_LOSS_PERCENT: "Pérdida de paquetes Opus (0-30)",
  RHAPSOD_SPOTIFY_CLIENT_ID: "Spotify Client ID (opcional)",
  RHAPSOD_SPOTIFY_CLIENT_SECRET: "Spotify Client Secret (opcional)",
  RHAPSOD_SPOTIFY_REFRESH_TOKEN: "Spotify Refresh Token (opcional)",
  RHAPSOD_AUDIO_TEST_TONE_SECONDS: "Tono de prueba al iniciar (0 = off)",
  RHAPSOD_LOG_LEVEL: "Nivel de log (trace/debug/info/warn/error/fatal)",
  RHAPSOD_LOG_RETENTION_DAYS: "Días de retención de logs (1-90)",
  RHAPSOD_METRICS_INTERVAL_MINUTES: "Intervalo de métricas (0 = off)",
  RHAPSOD_WATCHDOG_INTERVAL_SECONDS:
    "Intervalo del watchdog en segundos (0 = off, default 15)",
  RHAPSOD_WATCHDOG_INTERVAL_MINUTES:
    "Obsoleto: usar RHAPSOD_WATCHDOG_INTERVAL_SECONDS (solo 0 = off)",
  RHAPSOD_MAX_CONCURRENT_COMMANDS: "Comandos concurrentes máx. (1-20)",
  RHAPSOD_MAX_CONCURRENT_YTDLP_JOBS: "Jobs yt-dlp concurrentes (1-4)",
  RHAPSOD_MAX_QUEUE_TRACKS: "Tracks máx. en cola (1-1000)",
  RHAPSOD_MAX_TRACKS_PER_USER: "Tracks por usuario (1-200)",
  RHAPSOD_VOTE_SKIP:
    "Votación para saltar: más de la mitad del canal (true/false, default false)",
  RHAPSOD_SKIP_NON_MUSIC:
    "Saltar intros y outros sin música de los videoclips vía SponsorBlock (true/false, default false)",
  RHAPSOD_MOVE_GROUP_IDS: "Group IDs para !move",
  RHAPSOD_MOVE_ADMIN_CHANNELS: "Channels para move admin",
  RHAPSOD_MOVE_SENIOR_CHANNELS: "Channels para move senior",
  RHAPSOD_MOVE_ADMIN_GROUP_IDS: "Group IDs admin move",
  RHAPSOD_MOVE_SENIOR_GROUP_IDS: "Group IDs senior move",
  RHAPSOD_VERBOSE: "Modo verbose (true/false)",
  RHAPSOD_PANEL_ENABLED: "Panel habilitado (true/false)",
  RHAPSOD_PANEL_PORT: "Puerto del panel (default 8080)",
  RHAPSOD_PANEL_USER: "Usuario del panel",
  RHAPSOD_PANEL_PASSWORD: "Contraseña del panel",
  RHAPSOD_PANEL_HOST: "Bind del panel (solo lectura, default 127.0.0.1)",
};

function describeEnvKey(key: string): string {
  return ENV_DESCRIPTIONS[key] ?? "";
}

export function describedEnvKeys(): readonly string[] {
  return Object.keys(ENV_DESCRIPTIONS);
}

function isKnownEnvKey(key: string): boolean {
  return Object.hasOwn(ENV_DESCRIPTIONS, key);
}

// Shown but never written from the web. The bind address: flipping it to
// 0.0.0.0 by accident would expose a localhost-only surface. The binary
// paths: pointing one at any file turns panel credentials into code
// execution on the next track. The env file path: it is only honored from
// the real environment.
const READONLY_ENV_KEYS = new Set([
  "RHAPSOD_PANEL_HOST",
  "RHAPSOD_YTDLP_PATH",
  "RHAPSOD_FFMPEG_PATH",
  "RHAPSOD_FFPROBE_PATH",
  "RHAPSOD_ENV_FILE",
]);

// Defaults shipped in config.ts and .env.example. A panel that edits the env
// file and restarts the bot must not open with a password anyone can read.
const WEAK_PANEL_PASSWORDS = new Set([
  "rhapsod",
  "change-me",
  "admin",
  "password",
]);

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

/**
 * Browsers resend cached basic-auth credentials on cross-site requests, and
 * a form posted with enctype=text/plain reaches a JSON handler without a
 * CORS preflight. Writes therefore need a JSON content type (a cross-site
 * page cannot send one without a preflight this server never answers) and,
 * when the browser reports it, a same-origin source.
 */
export function isAllowedPanelWrite(headers: {
  readonly contentType: string | undefined;
  readonly fetchSite: string | undefined;
  readonly origin: string | undefined;
  readonly host: string | undefined;
}): boolean {
  if (!/^application\/json\s*(;|$)/i.test(headers.contentType ?? "")) {
    return false;
  }
  if (
    headers.fetchSite !== undefined &&
    headers.fetchSite !== "same-origin" &&
    headers.fetchSite !== "none"
  ) {
    return false;
  }
  if (headers.origin === undefined) return true;
  try {
    return new URL(headers.origin).host === headers.host;
  } catch {
    return false;
  }
}

function isEditableEnvKey(key: string): boolean {
  return isKnownEnvKey(key) && !READONLY_ENV_KEYS.has(key);
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
  const panelHost = options.config.RHAPSOD_PANEL_HOST;

  if (WEAK_PANEL_PASSWORDS.has(panelPassword)) {
    options.logger.error(
      "Panel disabled: RHAPSOD_PANEL_PASSWORD is a published default; set a unique password and restart",
    );
    return { close: () => Promise.resolve() };
  }
  if (!LOOPBACK_HOSTS.has(panelHost)) {
    options.logger.warn(
      { host: panelHost },
      "Panel is bound to a non-loopback address; it is meant to be reached through an SSH tunnel",
    );
  }

  const failedLoginDelayMs =
    options.failedLoginDelayMs ?? FAILED_LOGIN_DELAY_MS;
  // A tunnel user can still script password guesses; a pause per wrong
  // password slows that down. verifyUser only runs when the request carries
  // credentials, so the browser's first prompt answers at once.
  app.use(
    "*",
    basicAuth({
      verifyUser: async (username, password) => {
        const matches = await Promise.all([
          timingSafeEqual(panelUser, username),
          timingSafeEqual(panelPassword, password),
        ]);
        if (matches.every(Boolean)) return true;
        await new Promise((resolve) => setTimeout(resolve, failedLoginDelayMs));
        return false;
      },
    }),
  );

  // The panel is polled every few seconds at most, so keep-alive buys
  // nothing here — and reused sockets have been observed stalling responses
  // (server answers on a socket the client no longer reads). Close each
  // connection after its response to avoid the whole class of races.
  // The same pass sets the browser-facing security headers: everything here
  // is same-origin HTML/JSON with inline scripts, so the CSP allows inline
  // styles/scripts and denies everything else that matters.
  app.use("*", async (c, next) => {
    await next();
    c.header("Connection", "close");
    // Owner console on a tunnel: never let the browser heuristically cache
    // HTML or API payloads. Stale pages after a deploy submit old shapes to
    // new endpoints (and old JS against new APIs), which surfaces as
    // breakage that only a hard refresh fixes.
    c.header("Cache-Control", "no-store");
    c.header("X-Frame-Options", "DENY");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    );
  });

  app.use("*", async (c, next) => {
    if (c.req.method === "GET" || c.req.method === "HEAD") return next();
    const allowed = isAllowedPanelWrite({
      contentType: c.req.header("content-type"),
      fetchSite: c.req.header("sec-fetch-site"),
      origin: c.req.header("origin"),
      host: c.req.header("host"),
    });
    if (!allowed) {
      return c.json({ ok: false, error: "Solicitud rechazada" }, 403);
    }
    return next();
  });

  app.get("/", (c) => {
    const status = options.status();
    // Served uncompressed on purpose. Compressing here used to set
    // content-length from the gzip buffer while the runtime still wrote the
    // original bytes to the socket, so browsers read content-length bytes and
    // then waited forever for a response they already considered complete —
    // an endless spinner, and a re-prompt for basic auth on every retry.
    // The dashboard is ~31KB of localhost traffic behind an SSH tunnel, so
    // compression buys little and cost a hang.
    return c.html(renderDashboard(status));
  });

  app.get("/setup", (c) => {
    return c.html(renderSetupWizard());
  });

  app.get("/settings", (c) => {
    return c.html(renderSettingsPage());
  });

  app.get("/commands", (c) => {
    return c.html(renderCommandsPage());
  });

  app.get("/server", (c) => {
    return c.html(renderServerPage());
  });

  app.get("/favicon.ico", (c) =>
    c.body(FAVICON_SVG, 200, { "Content-Type": "image/svg+xml" }),
  );

  // 503 only while reconnecting: deploy.sh rolls back on it. A failing
  // YouTube login or daemon still plays through fallbacks, so it is
  // reported in the body without failing the check.
  // The notice verdict rides in the body only. The status code stays a
  // liveness signal for deploy.sh, which rolls back on anything but 200: a
  // persistent critical notice (a reconnect give-up, an exposed panel) would
  // otherwise roll back every deploy, including the one that fixes it.
  app.get("/api/health", (c) => {
    const status = options.status();
    const body: PanelHealth =
      options.notices === undefined
        ? status
        : {
            ...status,
            verdict: options.notices.verdict(),
            openNotices: options.notices
              .list()
              .filter((notice) => notice.state !== "ignored").length,
          };
    return c.json(body, status.reconnecting === true ? 503 : 200);
  });

  app.get("/api/metrics", (c) => {
    if (options.metricsText === undefined) return c.notFound();
    return c.body(options.metricsText(), 200, {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
    });
  });

  app.get("/api/state", (c) => {
    const status = options.status();
    const queue = options.queue();
    // Single round trip per poll: queue + errors + chat + server tree ride
    // along with status so the dashboard needs only one request per refresh.
    const errors =
      options.errors === undefined
        ? { totalErrors: 0, byCategory: {}, recent: [] }
        : options.errors();
    const chat = options.chat === undefined ? [] : options.chat();
    const server =
      options.serverView === undefined
        ? { version: 0, botChannelId: 0, channels: [], clients: [] }
        : options.serverView();
    const notices =
      options.notices === undefined
        ? []
        : options.notices.list().map(toPanelNotice);
    return c.json({ ...status, queue, errors, chat, server, notices });
  });

  app.post("/api/notices/ignore", async (c) => {
    if (options.notices === undefined) {
      return c.json({ ok: false, error: "Avisos no disponibles" }, 501);
    }
    const body: unknown = await c.req.json().catch(() => undefined);
    const key =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>).key
        : undefined;
    if (typeof key !== "string" || key.length === 0 || key.length > 200) {
      return c.json({ ok: false, error: "Aviso inválido" }, 400);
    }
    if (!options.notices.ignore(key)) {
      return c.json({ ok: false, error: "El aviso ya no está abierto" }, 404);
    }
    return c.json({ ok: true });
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
      editable: isEditableEnvKey(key),
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
    // Only known RHAPSOD_* keys are writable. The env file is also read by the
    // wider system, so an unrestricted write would let the panel overwrite or
    // inject arbitrary variables (e.g. PATH-adjacent or future config).
    const unknown = Object.keys(incoming).filter((key) => !isKnownEnvKey(key));
    if (unknown.length > 0) {
      return c.json(
        { ok: false, error: "Clave desconocida: " + unknown.join(", ") },
        400,
      );
    }
    const readonlyKeys = Object.keys(incoming).filter(
      (key) => !isEditableEnvKey(key),
    );
    if (readonlyKeys.length > 0) {
      return c.json(
        {
          ok: false,
          error: "Clave de solo lectura: " + readonlyKeys.join(", "),
        },
        400,
      );
    }
    const unsafeKeys = Object.entries(incoming)
      .filter(([, raw]) => typeof raw === "string" && !isSafeEnvValue(raw))
      .map(([key]) => key);
    if (unsafeKeys.length > 0) {
      return c.json(
        {
          ok: false,
          error: "Valor con saltos de linea: " + unsafeKeys.join(", "),
        },
        400,
      );
    }
    for (const [key, raw] of Object.entries(incoming)) {
      const value = typeof raw === "string" ? raw : "";
      if (value === "") {
        delete env.values[key];
      } else {
        env.values[key] = value;
      }
    }
    // Only the keys this request touches can block the save: dotenv strips
    // quotes the raw parser keeps, so an untouched quoted value elsewhere
    // must not make every save fail.
    const invalid = validateConfig(env.values).filter((issue) =>
      Object.hasOwn(incoming, issue.key),
    );
    if (invalid.length > 0) {
      return c.json(
        {
          ok: false,
          error:
            "Valor invalido: " +
            invalid
              .map((issue) => `${issue.key} (${issue.message})`)
              .join(", "),
        },
        400,
      );
    }
    try {
      await saveEnvFile(options.envFilePath, env.values);
    } catch {
      return c.json(
        { ok: false, error: "No se pudo escribir el archivo de entorno" },
        500,
      );
    }
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
    // Let the response reach the browser before the process goes away.
    setTimeout(() => options.restart(), 250);
    return c.json({ ok: true, message: "Reiniciando..." });
  });

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
    "Panel listening",
  );

  return {
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
