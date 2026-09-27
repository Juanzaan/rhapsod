import type { YoutubeAuthFailureCategory } from "../../lib/youtube-auth-health.js";
import type { DaemonHealthSnapshot } from "../../media/youtube/daemon-health.js";
import type { Finding, NoticeDetector } from "./notice.js";

const DAY = 24 * 60 * 60 * 1_000;
const MB = 1024 * 1024;

export const YOUTUBE_AUTH_DETECTORS: readonly NoticeDetector[] = [
  "youtube.extraction-failed",
  "youtube.cookies-invalid",
  "youtube.soft-block",
];

/**
 * DRM, region and members-only failures never reach this: the canary uses a
 * fixed public video, so its categories are about the bot, not a track.
 */
export function youtubeAuthFinding(
  category: YoutubeAuthFailureCategory,
  warpConfigured: boolean,
): Finding {
  switch (category) {
    case "cookies-invalid":
      return {
        detector: "youtube.cookies-invalid",
        severity: "error",
        titleEs: "YouTube pide iniciar sesión",
        detailEs:
          "Las cookies de YouTube faltan o ya no sirven. Cargar cookies nuevas de una cuenta en el paso YouTube del panel.",
      };
    case "soft-block":
      return {
        detector: "youtube.soft-block",
        severity: "error",
        titleEs: "YouTube bloquea al bot",
        detailEs: warpConfigured
          ? "YouTube bloquea al bot aun a través de WARP. Cargar cookies de una cuenta en el paso YouTube del panel."
          : "YouTube bloquea la IP del servidor, algo común en un VPS. Activar WARP con RHAPSOD_WITH_WARP=1 al correr el instalador, o cargar cookies en el panel.",
        data: { warpConfigured },
      };
    default:
      return {
        detector: "youtube.extraction-failed",
        severity: "error",
        titleEs: "yt-dlp no puede leer YouTube",
        detailEs:
          "La prueba diaria con un video público falla. Suele arreglarse actualizando yt-dlp; revisar los logs del bot si sigue.",
      };
  }
}

export function daemonFallbackFinding(
  snapshot: DaemonHealthSnapshot,
): Finding | undefined {
  if (snapshot.consecutiveFailures < 3) return undefined;
  return {
    detector: "ytdlp.daemon-fallback",
    severity: "warning",
    titleEs: "El daemon de yt-dlp está fallando",
    detailEs:
      "Las canciones siguen sonando, pero cada una tarda más porque el bot lanza yt-dlp por su cuenta. Revisar el servicio rhapsod-ytdlp-daemon.",
    data: {
      consecutiveFailures: snapshot.consecutiveFailures,
      ...(snapshot.lastFailureReason === undefined
        ? {}
        : { reason: snapshot.lastFailureReason }),
    },
  };
}

export function potProviderDownFinding(endpoint: PotEndpoint): Finding {
  return {
    detector: "pot.provider-down",
    severity: "warning",
    titleEs: "El proveedor de PO tokens no responde",
    detailEs: `Nada escucha en ${endpoint.host}:${String(endpoint.port)}. YouTube puede empezar a bloquear al bot. Revisar el servicio bgutil-pot-provider.`,
    data: { host: endpoint.host, port: endpoint.port },
  };
}

export function noTalkPowerFinding(channelId: number): Finding {
  return {
    detector: "ts3.no-talk-power",
    severity: "error",
    titleEs: "El bot no puede hablar en su canal",
    detailEs:
      "El canal pide más talk power que el que tiene el bot, así que no se escucha nada. Dar talk power al bot o moverlo con !channel-move.",
    data: { channelId },
  };
}

export function reconnectingFinding(
  attempt: number,
  maxAttempts: number,
): Finding {
  return {
    detector: "ts3.reconnecting",
    severity: attempt <= 2 ? "warning" : "error",
    titleEs: "Se perdió la conexión con TeamSpeak",
    detailEs: `Reconectando (intento ${String(attempt)} de ${String(maxAttempts)}). La música sigue donde quedó al volver.`,
    data: { attempt, maxAttempts },
  };
}

export function reconnectGaveUpFinding(maxAttempts: number): Finding {
  return {
    detector: "ts3.reconnecting",
    subject: "gave-up",
    severity: "critical",
    titleEs: "El bot se reinició tras perder TeamSpeak",
    detailEs: `No pudo reconectar en ${String(maxAttempts)} intentos y se reinició. Si se repite, revisar la red del servidor y que TeamSpeak esté arriba.`,
    persistent: true,
    data: { maxAttempts },
  };
}

export function eventLoopStallFinding(driftMs: number): Finding {
  return {
    detector: "process.event-loop-stall",
    severity: "error",
    titleEs: "El bot se trabó y se reinició",
    detailEs: `El proceso quedó bloqueado ${String(Math.round(driftMs / 1_000))} s y el watchdog lo reinició. Si se repite, revisar CPU y memoria del servidor.`,
    data: { driftMs: Math.round(driftMs) },
  };
}

export const RESTART_LOOP_WINDOW_MS = 15 * 60_000;
export const RESTART_LOOP_STARTS = 4;

export function restartLoopFinding(
  starts: readonly number[],
  now: number,
): Finding | undefined {
  const recent = starts.filter((at) => now - at < RESTART_LOOP_WINDOW_MS);
  if (recent.length < RESTART_LOOP_STARTS) return undefined;
  return {
    detector: "process.restart-loop",
    severity: "critical",
    titleEs: "El bot se reinicia una y otra vez",
    detailEs: `Arrancó ${String(recent.length)} veces en 15 minutos. Revisar los logs del bot para ver por qué se cae.`,
    data: { starts: recent.length },
  };
}

export function isLoopbackHost(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    bare === "localhost" || bare === "::1" || /^127(?:\.\d{1,3}){3}$/.test(bare)
  );
}

export function panelBindFinding(config: {
  readonly RHAPSOD_PANEL_ENABLED: boolean;
  readonly RHAPSOD_PANEL_HOST: string;
}): Finding | undefined {
  if (!config.RHAPSOD_PANEL_ENABLED) return undefined;
  if (isLoopbackHost(config.RHAPSOD_PANEL_HOST)) return undefined;
  return {
    detector: "panel.bind-exposed",
    severity: "critical",
    titleEs: "El panel está expuesto fuera del servidor",
    detailEs:
      "RHAPSOD_PANEL_HOST no es 127.0.0.1, así que cualquiera que llegue al puerto ve el login del panel. Volver a poner RHAPSOD_PANEL_HOST=127.0.0.1 y entrar por un túnel SSH.",
    data: { host: config.RHAPSOD_PANEL_HOST },
  };
}

const DISK_WARNING_BYTES = 1024 * MB;
const DISK_ERROR_BYTES = 200 * MB;
// Clears 10 % above the threshold that opened it, so free space hovering
// around 1 GB does not open and close the notice on every check.
const DISK_CLEAR_MARGIN = 1.1;

export function diskFinding(
  freeBytes: number,
  wasOpen: boolean,
): Finding | "ok" | "hold" {
  const freeMb = Math.round(freeBytes / MB);
  if (freeBytes < DISK_ERROR_BYTES) {
    return diskNotice("error", freeMb);
  }
  if (freeBytes < DISK_WARNING_BYTES) {
    return diskNotice("warning", freeMb);
  }
  if (wasOpen && freeBytes < DISK_WARNING_BYTES * DISK_CLEAR_MARGIN) {
    return "hold";
  }
  return "ok";
}

function diskNotice(severity: "warning" | "error", freeMb: number): Finding {
  return {
    detector: "disk.data-low",
    severity,
    titleEs: "Queda poco espacio en disco",
    detailEs: `Quedan ${String(freeMb)} MB libres donde el bot guarda sus datos y logs. Liberar espacio antes de que deje de guardar la cola y las playlists.`,
    data: { freeMb },
  };
}

// Names from general knowledge of Google sign-in cookies; the file's expiry
// is only a lower bound anyway, since YouTube rotates sessions server-side.
const AUTH_COOKIE_NAMES = new Set([
  "SID",
  "HSID",
  "SSID",
  "SAPISID",
  "__Secure-1PSID",
  "__Secure-3PSID",
  "LOGIN_INFO",
]);

export type CookiesFileSummary =
  | {
      readonly ok: true;
      readonly hasHeader: boolean;
      readonly youtubeCookies: number;
      /** Earliest expiry of the sign-in cookies, in epoch ms. */
      readonly authExpiresAt?: number;
    }
  | { readonly ok: false; readonly reason: "empty" | "malformed" };

/**
 * Reads a Netscape cookies.txt without keeping any value: only names,
 * domains and expiry dates leave this function.
 */
export function summarizeCookiesFile(text: string): CookiesFileSummary {
  const lines = text.split(/\r?\n/);
  const hasHeader = /^#\s*(Netscape )?HTTP Cookie File/i.test(
    lines[0]?.trim() ?? "",
  );
  let valid = 0;
  let malformed = 0;
  let youtubeCookies = 0;
  let authExpiresAt: number | undefined;
  for (const raw of lines) {
    if (raw.trim() === "") continue;
    let line = raw;
    if (line.startsWith("#HttpOnly_")) line = line.slice("#HttpOnly_".length);
    else if (line.trimStart().startsWith("#")) continue;
    const fields = line.split("\t");
    if (fields.length < 7) {
      malformed++;
      continue;
    }
    valid++;
    const domain = fields[0] ?? "";
    const expiry = Number(fields[4]);
    const name = fields[5] ?? "";
    if (!/(^|\.)youtube\.com$/i.test(domain)) continue;
    youtubeCookies++;
    if (!AUTH_COOKIE_NAMES.has(name) || !Number.isFinite(expiry)) continue;
    // 0 marks a session cookie: no expiry date to warn about.
    if (expiry <= 0) continue;
    const expiresAt = expiry * 1_000;
    authExpiresAt =
      authExpiresAt === undefined
        ? expiresAt
        : Math.min(authExpiresAt, expiresAt);
  }
  if (valid === 0)
    return { ok: false, reason: malformed > 0 ? "malformed" : "empty" };
  return {
    ok: true,
    hasHeader,
    youtubeCookies,
    ...(authExpiresAt === undefined ? {} : { authExpiresAt }),
  };
}

const COOKIES_WARN_MS = 14 * DAY;
const COOKIES_CLEAR_MS = 15 * DAY;

export function cookiesFinding(
  summary: CookiesFileSummary | "missing",
  now: number,
  wasOpen: boolean,
): Finding | "ok" | "hold" {
  if (summary === "missing") {
    return cookiesNotice(
      "error",
      "No se encuentra el archivo de cookies de YouTube",
      "RHAPSOD_YTDLP_COOKIES_PATH apunta a un archivo que no existe. Cargar las cookies de nuevo en el paso YouTube del panel.",
    );
  }
  if (!summary.ok || summary.youtubeCookies === 0) {
    return cookiesNotice(
      "error",
      "El archivo de cookies de YouTube no sirve",
      "No tiene cookies de youtube.com en formato Netscape (columnas separadas por tabulaciones). Exportarlas de nuevo desde una ventana privada.",
    );
  }
  const expiresAt = summary.authExpiresAt;
  if (expiresAt !== undefined && expiresAt <= now) {
    return cookiesNotice(
      "error",
      "Las cookies de YouTube vencieron",
      "Las cookies de inicio de sesión ya vencieron. Exportarlas de nuevo desde una ventana privada y cargarlas en el panel.",
      expiresAt,
    );
  }
  if (expiresAt !== undefined && expiresAt - now < COOKIES_WARN_MS) {
    const days = Math.max(1, Math.floor((expiresAt - now) / DAY));
    return cookiesNotice(
      "warning",
      "Las cookies de YouTube vencen pronto",
      `Vencen en ${String(days)} días. YouTube puede invalidarlas antes; conviene cargar unas nuevas.`,
      expiresAt,
    );
  }
  if (!summary.hasHeader) {
    return cookiesNotice(
      "warning",
      "Al archivo de cookies le falta el encabezado",
      'La primera línea debe ser "# Netscape HTTP Cookie File"; sin ella yt-dlp puede rechazar el archivo.',
    );
  }
  if (
    wasOpen &&
    expiresAt !== undefined &&
    expiresAt - now < COOKIES_CLEAR_MS
  ) {
    return "hold";
  }
  return "ok";
}

function cookiesNotice(
  severity: "warning" | "error",
  titleEs: string,
  detailEs: string,
  expiresAt?: number,
): Finding {
  return {
    detector: "youtube.cookies-expiring",
    severity,
    titleEs,
    detailEs,
    ...(expiresAt === undefined
      ? {}
      : { data: { expiresAt: new Date(expiresAt).toISOString() } }),
  };
}

export interface PotEndpoint {
  readonly host: string;
  readonly port: number;
}

// scripts/yt-dlp-daemon.py always asks this address.
const DAEMON_POT_ENDPOINT: PotEndpoint = { host: "127.0.0.1", port: 4416 };

/**
 * Where the bot expects a PO token provider, or undefined when nothing in
 * the config uses one: the daemon always does, the spawned yt-dlp only when
 * the extractor args name a `po_token_uri` or bgutil `base_url`.
 */
export function potEndpoint(config: {
  readonly RHAPSOD_YTDLP_EXTRACTOR_ARGS?: string | undefined;
  readonly RHAPSOD_YTDLP_DAEMON_URL?: string | undefined;
}): PotEndpoint | undefined {
  const match = /(?:po_token_uri|base_url)=([^\s;,]+)/.exec(
    config.RHAPSOD_YTDLP_EXTRACTOR_ARGS ?? "",
  );
  if (match?.[1] !== undefined) {
    try {
      const url = new URL(match[1]);
      const port =
        url.port === ""
          ? url.protocol === "https:"
            ? 443
            : 80
          : Number(url.port);
      return { host: url.hostname.replace(/^\[|\]$/g, ""), port };
    } catch {
      return undefined;
    }
  }
  if (config.RHAPSOD_YTDLP_DAEMON_URL !== undefined) return DAEMON_POT_ENDPOINT;
  return undefined;
}
