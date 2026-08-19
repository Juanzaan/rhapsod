import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { YoutubeTrackMetadata } from "./youtube/yt-dlp.js";

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

export class DirectUrlClient implements DirectUrlResolver {
  readonly name = "direct-url";
  readonly #fetch: typeof fetch;
  readonly #ffprobeBinary: string;
  readonly #timeoutMs: number;

  constructor(options: DirectUrlResolverOptions = {}) {
    this.#fetch = options.fetch ?? fetch;
    this.#ffprobeBinary = options.ffprobeBinary ?? "ffprobe";
    this.#timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  }

  async match(url: string): Promise<boolean> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return false;
    }
    const lastSegment =
      parsed.pathname.split("/").filter(Boolean).pop()?.toLowerCase() ?? "";
    const dot = lastSegment.lastIndexOf(".");
    if (dot > 0) {
      return DIRECT_AUDIO_EXTENSIONS.has(lastSegment.slice(dot));
    }
    return this.#hasAudioContentType(parsed.toString());
  }

  async getTrack(url: string): Promise<YoutubeTrackMetadata> {
    const probe = await this.#probe(url);
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

  getAudioUrl(url: string): Promise<string> {
    return Promise.resolve(url);
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
        url,
      ],
      { maxBuffer: 1024 * 1024, timeout: this.#timeoutMs, windowsHide: true },
    );
    try {
      const parsed = JSON.parse(stdout) as FfprobeJson;
      if (parsed.format === undefined) {
        throw new Error("ffprobe returned no format info");
      }
      return parsed.format;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error("ffprobe returned invalid JSON", { cause: error });
      }
      throw error;
    }
  }

  async #hasAudioContentType(url: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), HEAD_TIMEOUT_MS);
      try {
        const response = await this.#fetch(url, {
          headers: { "user-agent": "Rhapsod/1 (audio-probe)" },
          method: "HEAD",
          redirect: "follow",
          signal: controller.signal,
        });
        if (!response.ok) return false;
        const contentType = response.headers
          .get("content-type")
          ?.split(";", 1)[0]
          ?.trim()
          .toLowerCase();
        return (
          contentType !== undefined &&
          DIRECT_AUDIO_CONTENT_TYPES.has(contentType)
        );
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return false;
    }
  }

  #fallbackTitle(url: string, hasDuration: boolean): string {
    if (hasDuration) {
      const filename =
        decodeURIComponent(url.split("/").pop() ?? "").replace(
          /\.[^.]+$/,
          "",
        ) || "Audio";
      return filename.replace(/[_-]+/g, " ").trim() || "Audio";
    }
    try {
      return `Radio: ${new URL(url).hostname}`;
    } catch {
      return "Radio";
    }
  }
}
