import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { YoutubeTrackMetadata } from "./youtube/yt-dlp.js";
import { isPublicHostname } from "../lib/ssrf.js";

const execFileAsync = promisify(execFile);

const DIRECT_AUDIO_EXTENSIONS = new Set([
  ".aac",
  ".flac",
  ".m4a",
  ".mp3",
  ".m3u8",
  ".oga",
  ".ogg",
  ".opus",
  ".wav",
]);

const DIRECT_AUDIO_CONTENT_TYPES = new Set([
  "application/mpegurl",
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "audio/aac",
  "audio/flac",
  "audio/mp4",
  "audio/mpeg",
  "audio/mpegurl",
  "audio/ogg",
  "audio/opus",
  "audio/wav",
  "audio/x-flac",
  "audio/x-m4a",
  "audio/x-wav",
]);

const PROBE_TIMEOUT_MS = 20_000;
const HEAD_TIMEOUT_MS = 8_000;
const MAX_REDIRECT_HOPS = 5;
const MATCH_CACHE_MAX_ENTRIES = 200;

interface FfprobeFormat {
  readonly duration?: string;
  readonly tags?: { readonly artist?: string; readonly title?: string };
}

interface FfprobeJson {
  readonly format?: FfprobeFormat;
}

export interface DirectUrlResolver {
  readonly name: string;
  match(input: string): Promise<boolean>;
  getTrack(url: string): Promise<YoutubeTrackMetadata>;
  getAudioUrl(url: string): Promise<string>;
}

export interface DirectUrlResolverOptions {
  readonly fetch?: typeof fetch;
  readonly ffprobeBinary?: string;
  readonly timeoutMs?: number;
}

interface ValidatedUrl {
  readonly contentType?: string;
  readonly finalUrl: string;
}

export class DirectUrlClient implements DirectUrlResolver {
  readonly name = "direct-url";
  readonly #fetch: typeof fetch;
  readonly #ffprobeBinary: string;
  readonly #timeoutMs: number;
  readonly #matchCache = new Map<string, boolean>();
  readonly #validatedUrls = new Map<string, ValidatedUrl>();

  constructor(options: DirectUrlResolverOptions = {}) {
    this.#fetch = options.fetch ?? fetch;
    this.#ffprobeBinary = options.ffprobeBinary ?? "ffprobe";
    this.#timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  }

  async match(url: string): Promise<boolean> {
    const cached = this.#matchCache.get(url);
    if (cached !== undefined) return cached;
    const result = await this.#matchImpl(url);
    this.#matchCache.set(url, result);
    if (this.#matchCache.size > MATCH_CACHE_MAX_ENTRIES) {
      const oldest = this.#matchCache.keys().next().value;
      if (oldest !== undefined) this.#matchCache.delete(oldest);
    }
    return result;
  }

  async #matchImpl(url: string): Promise<boolean> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (parsed.protocol !== "https:") return false;
    if (!(await isPublicHostname(parsed.hostname))) return false;
    const lastSegment =
      parsed.pathname.split("/").filter(Boolean).pop()?.toLowerCase() ?? "";
    const dot = lastSegment.lastIndexOf(".");
    if (dot > 0) {
      return DIRECT_AUDIO_EXTENSIONS.has(lastSegment.slice(dot));
    }
    const validated = await this.#validateRedirectChain(parsed.toString());
    if (validated === undefined) return false;
    return (
      validated.contentType !== undefined &&
      DIRECT_AUDIO_CONTENT_TYPES.has(validated.contentType)
    );
  }

  async getTrack(url: string): Promise<YoutubeTrackMetadata> {
    const validated = await this.#validateRedirectChain(url, false);
    if (validated === undefined) {
      throw new Error("No se pudo validar la URL de audio");
    }
    const probe = await this.#probe(validated.finalUrl);
    const duration = Number.parseFloat(probe.duration ?? "");
    const hasDuration = Number.isFinite(duration) && duration > 0;
    const title =
      probe.tags?.artist !== undefined && probe.tags.title !== undefined
        ? `${probe.tags.artist} - ${probe.tags.title}`
        : (probe.tags?.title ?? this.#fallbackTitle(url, hasDuration));
    return {
      ...(hasDuration ? { durationSeconds: Math.round(duration) } : {}),
      id: createHash("sha1").update(url).digest("hex").slice(0, 12),
      title,
      webpageUrl: url,
    };
  }

  async getAudioUrl(url: string): Promise<string> {
    const validated = await this.#validateRedirectChain(url, false);
    if (validated === undefined) {
      throw new Error("No se pudo validar la URL de audio");
    }
    return validated.finalUrl;
  }

  async #validateRedirectChain(
    url: string,
    useCache = true,
  ): Promise<ValidatedUrl | undefined> {
    if (useCache) {
      const cached = this.#validatedUrls.get(url);
      if (cached !== undefined) return cached;
    }
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
      let parsed: URL;
      try {
        parsed = new URL(current);
      } catch {
        return undefined;
      }
      if (parsed.protocol !== "https:") return undefined;
      if (!(await isPublicHostname(parsed.hostname))) return undefined;
      const response = await this.#head(current);
      if (response === undefined) return undefined;
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (location === null) return undefined;
        try {
          current = new URL(location, current).toString();
        } catch {
          return undefined;
        }
        continue;
      }
      if (response.status >= 200 && response.status < 300) {
        const contentType = response.headers
          .get("content-type")
          ?.split(";", 1)[0]
          ?.trim()
          .toLowerCase();
        const validated: ValidatedUrl = {
          ...(contentType === undefined ? {} : { contentType }),
          finalUrl: current,
        };
        this.#validatedUrls.set(url, validated);
        if (this.#validatedUrls.size > MATCH_CACHE_MAX_ENTRIES) {
          const oldest = this.#validatedUrls.keys().next().value;
          if (oldest !== undefined) this.#validatedUrls.delete(oldest);
        }
        return validated;
      }
      return undefined;
    }
    return undefined;
  }

  async #head(url: string): Promise<Response | undefined> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEAD_TIMEOUT_MS);
    try {
      return await this.#fetch(url, {
        headers: { "user-agent": "Rhapsod/1 (audio-probe)" },
        method: "HEAD",
        redirect: "manual",
        signal: controller.signal,
      });
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  async #probe(url: string): Promise<FfprobeFormat> {
    const { stdout } = await execFileAsync(
      this.#ffprobeBinary,
      [
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_entries",
        "format=duration:format_tags=title,artist",
        "-max_redirects",
        "0",
        url,
      ],
      { maxBuffer: 1024 * 1024, timeout: this.#timeoutMs, windowsHide: true },
    );
    try {
      const parsed = JSON.parse(stdout) as FfprobeJson;
      if (parsed.format === undefined) {
        throw new Error("No se pudo analizar el archivo de audio.");
      }
      return parsed.format;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error("No se pudo analizar el archivo de audio.", {
          cause: error,
        });
      }
      throw error;
    }
  }

  #fallbackTitle(url: string, hasDuration: boolean): string {
    if (hasDuration) {
      let filename = "Audio";
      try {
        filename =
          decodeURIComponent(url.split("/").pop() ?? "").replace(
            /\.[^.]+$/,
            "",
          ) || "Audio";
      } catch {
        // Malformed percent-encoding in the filename; fall back to "Audio".
      }
      return filename.replace(/[_-]+/g, " ").trim() || "Audio";
    }
    try {
      return `Radio: ${new URL(url).hostname}`;
    } catch {
      return "Radio";
    }
  }
}
