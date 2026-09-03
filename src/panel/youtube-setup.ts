import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export interface YoutubeHealth {
  readonly ok: boolean;
  readonly ms?: number;
  readonly error?: string;
}

const YOUTUBE_HEALTH_TIMEOUT_MS = 25_000;
const MAX_COOKIE_BYTES = 256 * 1024;

function sanitizeHealthError(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Error desconocido";
  const withoutUrls = raw.replace(/https?:\/\/[^\s"'<>]+/g, "[url]");
  const singleLine = withoutUrls.replace(/\s+/g, " ").trim();
  return singleLine.length > 160 ? `${singleLine.slice(0, 159)}…` : singleLine;
}

/**
 * Builds a YouTube health check using the same resolution path the bot uses
 * for playback (daemon first, spawn fallback). Returns ok with the resolve
 * latency, or ok:false with a short sanitized reason.
 */
export function createYoutubeHealthCheck(
  resolveAudioUrl: (url: string, signal?: AbortSignal) => Promise<string>,
  testUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  timeoutMs = YOUTUBE_HEALTH_TIMEOUT_MS,
): () => Promise<YoutubeHealth> {
  return async () => {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref();
    try {
      const url = await resolveAudioUrl(testUrl, controller.signal);
      if (typeof url !== "string" || !/^https:\/\//i.test(url)) {
        return { ok: false, error: "Respuesta inválida del resolvedor" };
      }
      return { ok: true, ms: Date.now() - started };
    } catch (error) {
      return { ok: false, error: sanitizeHealthError(error) };
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * Builds a cookies.txt saver. Writes atomically with 0600 permissions so
 * only the service user can read the YouTube session.
 */
export function createCookieSaver(
  cookiesPath: string,
): (content: string) => Promise<{ path: string }> {
  return async (content: string) => {
    if (typeof content !== "string" || content.trim().length === 0) {
      throw new Error("El contenido de cookies está vacío.");
    }
    if (Buffer.byteLength(content, "utf8") > MAX_COOKIE_BYTES) {
      throw new Error("El archivo de cookies es demasiado grande.");
    }
    const absolute = resolve(cookiesPath);
    await mkdir(dirname(absolute), { recursive: true });
    const temporary = `${absolute}.tmp`;
    await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, absolute);
    await chmod(absolute, 0o600);
    return { path: absolute };
  };
}
