import { spawn, type ChildProcessByStdio } from "node:child_process";
import { PassThrough, type Readable } from "node:stream";

import ffmpegStaticPath from "ffmpeg-static";

import { CHANNELS, SAMPLE_RATE } from "./opus-encoder.js";
import { sanitizeSensitive, sanitizeUrl } from "../observability/metrics.js";
import {
  buildFilterChain,
  type AudioFilter,
  type FilterParam,
} from "./filter-chain.js";

export interface FfmpegPcmOptions {
  readonly binary?: string;
  readonly spawnProcess?: typeof spawn;
  readonly loudnessTargetLufs?: number;
  readonly loudnessProfile?: {
    readonly measuredI: number;
    readonly measuredLra: number;
    readonly measuredThresh: number;
    readonly measuredTp: number;
  };
  readonly seekSeconds?: number;
  /**
   * Endless stream (radio). A 403 retry reconnects at the live edge instead
   * of seeking: ffmpeg would read and discard the whole seek offset first.
   */
  readonly live?: boolean;
  readonly userAgent?: string;
  /**
   * Optional HTTP proxy URL (e.g. Cloudflare WARP in proxy mode) used ONLY
   * as a fallback egress when the direct fetch hits a 403. The first attempt
   * is always direct; the proxy is never used unless a retry needs it.
   */
  readonly proxyUrl?: string;
  readonly audioFilter?: {
    readonly name: AudioFilter;
    readonly param?: FilterParam;
  };
}

export interface FfmpegPcmStream {
  readonly stream: PassThrough;
  readonly process: ChildProcessByStdio<null, Readable, Readable>;
  stop(): void;
}

const STOP_GRACE_MS = 3_000;

// The input URL is checked to be public HTTPS before ffmpeg runs, but ffmpeg
// then opens HLS segment and key URLs on its own; a public playlist listing
// http://169.254.169.254/ or http://127.0.0.1:8765/ made it fetch those.
// The whitelist keeps every nested open on TLS. It does not stop a 302 to a
// plain-HTTP host: ffmpeg follows redirects inside its http protocol over
// tcp, and builds before 7.1 have no option to turn that off.
// httpproxy is only needed for the 403 fallback egress.
export const FFMPEG_PROTOCOL_WHITELIST = "https,tls,tcp,crypto";

export function buildFfmpegPcmArguments(
  url: string,
  options: FfmpegPcmOptions = {},
  useProxy = false,
): string[] {
  if (!/^https:\/\//i.test(url)) {
    throw new Error("FFmpeg audio input must use HTTPS");
  }

  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-reconnect",
    "1",
    "-reconnect_streamed",
    "1",
    "-reconnect_delay_max",
    "5",
    "-protocol_whitelist",
    useProxy && options.proxyUrl !== undefined && options.proxyUrl.length > 0
      ? `${FFMPEG_PROTOCOL_WHITELIST},httpproxy`
      : FFMPEG_PROTOCOL_WHITELIST,
    "-rw_timeout",
    "8000000",
    "-timeout",
    "5000000",
  ];
  if (options.userAgent !== undefined && options.userAgent.length > 0) {
    args.push("-user_agent", options.userAgent);
  }
  if (options.seekSeconds !== undefined && options.seekSeconds > 0) {
    args.push("-ss", String(options.seekSeconds));
  }
  // Low-latency flags: skip buffering and probe delays so the first audio
  // frames reach the Opus encoder as soon as YouTube starts delivering them.
  // 320k is fast enough to avoid codec-detection stalls while reliable for
  // most YouTube stream formats (WebM/Opus, MP4/AAC).
  args.push("-fflags", "+nobuffer", "-flags", "+low_delay");
  args.push("-analyzeduration", "0", "-probesize", "327680");
  if (
    useProxy &&
    options.proxyUrl !== undefined &&
    options.proxyUrl.length > 0
  ) {
    args.push("-http_proxy", options.proxyUrl);
  }
  args.push(
    "-i",
    url,
    "-vn",
    "-f",
    "s16le",
    "-ar",
    String(SAMPLE_RATE),
    "-ac",
    String(CHANNELS),
    "-acodec",
    "pcm_s16le",
  );
  const loudnessFilter =
    options.loudnessProfile !== undefined &&
    options.loudnessTargetLufs !== undefined &&
    options.loudnessTargetLufs < 0
      ? `loudnorm=I=${options.loudnessTargetLufs}:TP=-1.5:LRA=11:measured_I=${options.loudnessProfile.measuredI}:measured_TP=${options.loudnessProfile.measuredTp}:measured_LRA=${options.loudnessProfile.measuredLra}:measured_thresh=${options.loudnessProfile.measuredThresh}:offset=0:linear=true`
      : options.loudnessTargetLufs !== undefined &&
          options.loudnessTargetLufs < 0
        ? `loudnorm=I=${options.loudnessTargetLufs}:TP=-1.5:LRA=11`
        : undefined;
  const filterChain = buildFilterChain(
    options.audioFilter?.name ?? "off",
    options.audioFilter?.param,
  );
  if (filterChain !== undefined) {
    const parts = [
      ...(loudnessFilter === undefined ? [] : [loudnessFilter]),
      filterChain,
      "alimiter=limit=0.95",
    ];
    args.push("-af", parts.join(","));
  } else if (loudnessFilter !== undefined) {
    args.push("-af", loudnessFilter);
  }
  args.push("pipe:1");
  return args;
}

/**
 * Matches the HTTP 403 wording ffmpeg ("Server returned 403 Forbidden") and
 * yt-dlp ("HTTP Error 403: Forbidden") print. A bare /403/ also matched the
 * digits of googlevideo URLs and itags echoed in unrelated errors.
 */
export function isForbiddenResponse(text: string): boolean {
  return /server returned 403|http error 403|\b403 forbidden\b/i.test(text);
}

const PCM_BYTES_PER_SECOND = SAMPLE_RATE * CHANNELS * 2;

const FFMPEG_403_RETRY_COUNT = 2;
const FFMPEG_403_RETRY_DELAY_MS = 1_500;

export function createFfmpegPcmStream(
  url: string,
  options: FfmpegPcmOptions = {},
): FfmpegPcmStream {
  const spawnProcess = options.spawnProcess ?? spawn;
  const binary = options.binary ?? ffmpegStaticPath ?? "ffmpeg";
  const stream = new PassThrough({ highWaterMark: 256 * 1024 });
  let stopped = false;
  let child = null as unknown as ChildProcessByStdio<null, Readable, Readable>;
  let stderr = "";
  let retries = 0;
  let usedProxy = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  // PCM already handed to the player across every ffmpeg attempt. A 403
  // retry resumes from here; restarting at the original offset replayed the
  // start of the track into the same stream.
  let emittedBytes = 0;

  const start = (useProxy = false): void => {
    if (stopped) return;
    usedProxy = useProxy;
    const resumeSeconds =
      options.live === true
        ? undefined
        : (options.seekSeconds ?? 0) + emittedBytes / PCM_BYTES_PER_SECOND;
    const args = buildFfmpegPcmArguments(
      url,
      {
        ...options,
        ...(resumeSeconds === undefined
          ? {}
          : { seekSeconds: Math.floor(resumeSeconds * 1_000) / 1_000 }),
      },
      useProxy,
    );
    stderr = "";
    child = spawnProcess(binary, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout.on("data", (chunk: Buffer) => {
      emittedBytes += chunk.length;
    });
    child.stdout.pipe(stream, { end: false });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-8_192);
    });
    child.on("error", (error) => {
      if (!stopped && !stream.destroyed) stream.destroy(error);
    });
    child.on("close", (code, signal) => {
      // Abnormal exits only, scrubbed: the raw line used to print on every
      // track end with the stream URL and ffmpeg's stderr, which can carry
      // signed URLs and tokens, straight to the journal.
      if (!stopped && code !== 0 && signal !== "SIGTERM") {
        process.stderr.write(
          `${JSON.stringify({
            msg: "FFmpeg exited",
            code,
            signal,
            retries,
            proxy: usedProxy,
            stderr: sanitizeUrl(sanitizeSensitive(stderr.trim())).slice(0, 200),
          })}\n`,
        );
      }
      if (stopped) {
        if (code === 0 || signal === "SIGTERM" || signal === "SIGKILL") return;
        if (!stream.destroyed) {
          const detail = stderr.trim();
          stream.destroy(
            new Error(
              `FFmpeg exited with code ${code ?? "unknown"}${detail ? `: ${detail}` : ""}`,
            ),
          );
        }
        return;
      }
      if (code === 0 || signal === "SIGTERM") {
        stream.end();
        return;
      }
      // Intermittent CDN 403: retry the same URL in place after a short delay.
      // The player stays in "buffering" and receives audio when a retry succeeds.
      // After the direct retries are exhausted, one last attempt goes through
      // the configured proxy egress (e.g. Cloudflare WARP) when available.
      if (isForbiddenResponse(stderr) && retries < FFMPEG_403_RETRY_COUNT) {
        retries++;
        retryTimer = setTimeout(() => start(false), FFMPEG_403_RETRY_DELAY_MS);
        retryTimer.unref();
        return;
      }
      if (
        isForbiddenResponse(stderr) &&
        !usedProxy &&
        options.proxyUrl !== undefined &&
        options.proxyUrl.length > 0
      ) {
        retryTimer = setTimeout(() => start(true), FFMPEG_403_RETRY_DELAY_MS);
        retryTimer.unref();
        return;
      }
      const detail = stderr.trim();
      stream.destroy(
        new Error(
          `FFmpeg exited with code ${code ?? "unknown"}${detail ? `: ${detail}` : ""}`,
        ),
      );
    });
  };

  start();

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    // A 403-retry timer pending when playback is skipped would spawn a fresh
    // ffmpeg into an already-ended stream with nothing left to kill it.
    if (retryTimer !== undefined) clearTimeout(retryTimer);
    child.stdout.unpipe(stream);
    stream.end();
    if (child.exitCode !== null || child.signalCode !== null) {
      // The process already exited (e.g. natural completion): nothing to kill.
      return;
    }
    child.kill("SIGTERM");
    const graceTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }, STOP_GRACE_MS);
    graceTimer.unref();
    child.once("exit", () => clearTimeout(graceTimer));
  };

  stream.once("close", () => {
    if (!stopped) stop();
  });

  return { process: child, stop, stream };
}
