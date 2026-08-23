import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lookup } from "node:dns/promises";
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
const DNS_TIMEOUT_MS = 5_000;
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
    if (!(await this.#isPublicHostname(parsed.hostname))) return false;
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
      if (!(await this.#isPublicHostname(parsed.hostname))) return undefined;
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

  async #isPublicHostname(hostname: string): Promise<boolean> {
    const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (isPrivateHost(normalized)) {
      return false;
    }
    if (normalized.includes(":") || /^\d+\.\d+\.\d+\.\d+$/.test(normalized)) {
      return true;
    }
    try {
      const addresses = await this.#lookupWithTimeout(normalized);
      return addresses.every(({ address }) => !isPrivateHost(address));
    } catch {
      return false;
    }
  }

  #lookupWithTimeout(
    hostname: string,
  ): Promise<readonly { address: string }[]> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("DNS lookup timed out"));
      }, DNS_TIMEOUT_MS);
      timer.unref();
      void lookup(hostname, { all: true, verbatim: true }).then(
        (addresses) => {
          clearTimeout(timer);
          resolve(addresses);
        },
        (error) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
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

function isPrivateHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost") return true;
  if (normalized.includes(":")) return isPrivateIpv6(normalized);
  return isPrivateIpv4(normalized);
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map((part) => Number(part));
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }
  const [a, b] = octets;
  if (a === undefined || b === undefined) return false;
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && (octets[2] === 0 || octets[2] === 2)) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && octets[2] === 100) return true;
  if (a === 203 && b === 0 && octets[2] === 113) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIpv6(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === "::" || lower === "::1" || lower === "0:0:0:0:0:0:0:1") {
    return true;
  }
  if (
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb")
  ) {
    return true;
  }
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("ff")) return true;
  if (lower.startsWith("2001:db8")) return true;
  if (lower.startsWith("64:ff9b")) return true;
  if (lower.startsWith("::ffff:")) {
    return isPrivateEmbeddedIpv4(lower.slice("::ffff:".length));
  }
  if (lower.startsWith("0:0:0:0:0:ffff:")) {
    return isPrivateEmbeddedIpv4(lower.slice("0:0:0:0:0:ffff:".length));
  }
  if (lower.startsWith("::")) {
    return isPrivateEmbeddedIpv4(lower.slice(2));
  }
  return false;
}

function isPrivateEmbeddedIpv4(embedded: string): boolean {
  if (embedded.includes(".")) return isPrivateIpv4(embedded);
  const hex = embedded.replace(/:/g, "");
  if (!/^[0-9a-f]{8}$/.test(hex)) return true;
  return isPrivateIpv4(
    [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
      Number.parseInt(hex.slice(6, 8), 16),
    ].join("."),
  );
}
