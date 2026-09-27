import { execFile, spawn, type ChildProcessByStdio } from "node:child_process";
import { PassThrough, type Readable } from "node:stream";
import { promisify } from "node:util";

import ffmpegStaticPath from "ffmpeg-static";

import { CHANNELS, SAMPLE_RATE } from "./opus-encoder.js";
import { sanitizeSensitive, sanitizeUrl } from "../observability/metrics.js";

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
  /**
   * The binary has the alimiter filter (see probeFfmpegFilter). Without it,
   * a measured profile keeps loudnorm's own linear pass.
   */
  readonly peakLimiter?: boolean;
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
  /**
   * Local egress guard (lib/egress-guard.ts) that every connection goes
   * through, including redirects and HLS segments. The WARP fallback
   * attempt replaces it: that egress leaves through Cloudflare, not this
   * host's network.
   */
  readonly egressProxyUrl?: string;
}

export interface FfmpegPcmStream {
  readonly stream: PassThrough;
  readonly process: ChildProcessByStdio<null, Readable, Readable>;
  stop(): void;
}

const STOP_GRACE_MS = 3_000;
const execFileAsync = promisify(execFile);

// The input URL is checked to be public HTTPS before ffmpeg runs, but ffmpeg
// then opens HLS segment and key URLs on its own; a public playlist listing
// http://169.254.169.254/ or http://127.0.0.1:8765/ made it fetch those.
// The whitelist keeps nested opens on TLS, but ffmpeg follows a 302 to a
// plain-HTTP host inside its http protocol, and reuses a keep-alive
// connection for the next HLS segment, both past the whitelist. The egress
// guard closes those: see ffmpegEgressArguments.
export const FFMPEG_PROTOCOL_WHITELIST = "https,tls,tcp,crypto";

/**
 * Input options that pin ffmpeg's connections: the protocol whitelist, and
 * the proxy every hop goes through when one is set. They must come before
 * the input.
 */
export function ffmpegEgressArguments(proxyUrl: string | undefined): string[] {
  if (proxyUrl === undefined || proxyUrl.length === 0) {
    return ["-protocol_whitelist", FFMPEG_PROTOCOL_WHITELIST];
  }
  return [
    "-protocol_whitelist",
    `${FFMPEG_PROTOCOL_WHITELIST},httpproxy`,
    "-http_proxy",
    proxyUrl,
  ];
}

/**
 * ffmpeg skips its proxy for hosts listed in `no_proxy`, which would let a
 * matching host bypass the egress guard, so the variable is dropped for
 * processes that use it.
 */
export function ffmpegEnvironment(
  egressProxyUrl: string | undefined,
): NodeJS.ProcessEnv | undefined {
  if (egressProxyUrl === undefined || egressProxyUrl.length === 0) {
    return undefined;
  }
  const env = { ...process.env };
  delete env.no_proxy;
  delete env.NO_PROXY;
  return env;
}

export function buildFfmpegPcmArguments(
  url: string,
  options: FfmpegPcmOptions = {},
  useProxy = false,
): string[] {
  if (!/^https:\/\//i.test(url)) {
    throw new Error("FFmpeg audio input must use HTTPS");
  }

  const proxy =
    useProxy && options.proxyUrl !== undefined && options.proxyUrl.length > 0
      ? options.proxyUrl
      : options.egressProxyUrl;
  const viaProxy = proxy !== undefined && proxy.length > 0;
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
    "-rw_timeout",
    "8000000",
    // With -http_proxy, ffmpeg rejects -timeout ("Option timeout not
    // found") and exits before connecting: every WARP fallback attempt used
    // to fail that way. -rw_timeout still bounds stalls, and the egress
    // guard bounds its own upstream connect.
    ...(viaProxy ? [] : ["-timeout", "5000000"]),
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
  args.push(...ffmpegEgressArguments(proxy));
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
  const loudnessFilter = buildLoudnessFilter(options);
  if (loudnessFilter !== undefined) {
    args.push("-af", loudnessFilter);
  }
  args.push("pipe:1");
  return args;
}

const PEAK_CEILING_DB = -1.5;
// A profile of a near-silent track asks for a 20-30 dB boost: the limiter
// would flatten the whole track and lift its noise floor with it. Quiet
// tracks stay a little quiet instead.
const MAX_BOOST_DB = 12;

/**
 * With a measured profile and alimiter available, a fixed gain plus a peak
 * limiter. loudnorm with linear=true silently switches to its dynamic mode
 * whenever the measured LRA exceeds its target or the gained peak would pass
 * the ceiling, so wide-range tracks were gain-ridden at 192 kHz despite the
 * profile. `level=false` keeps alimiter from re-normalizing its own output.
 */
export function buildLoudnessFilter(
  options: Pick<
    FfmpegPcmOptions,
    "loudnessProfile" | "loudnessTargetLufs" | "peakLimiter"
  >,
): string | undefined {
  const target = options.loudnessTargetLufs;
  if (target === undefined || target >= 0) return undefined;
  const profile = options.loudnessProfile;
  if (profile === undefined) {
    return `loudnorm=I=${target}:TP=${PEAK_CEILING_DB}:LRA=11`;
  }
  if (options.peakLimiter !== true) {
    return `loudnorm=I=${target}:TP=${PEAK_CEILING_DB}:LRA=11:measured_I=${profile.measuredI}:measured_TP=${profile.measuredTp}:measured_LRA=${profile.measuredLra}:measured_thresh=${profile.measuredThresh}:offset=0:linear=true`;
  }
  const gainDb = Math.min(MAX_BOOST_DB, target - profile.measuredI);
  const ceiling = 10 ** (PEAK_CEILING_DB / 20);
  return `volume=${gainDb.toFixed(2)}dB,alimiter=limit=${ceiling.toFixed(4)}:level=false`;
}

export function resolveFfmpegBinary(binary: string | undefined): string {
  return binary ?? ffmpegStaticPath ?? "ffmpeg";
}

/**
 * Whether the binary lists `filter` in `ffmpeg -filters`. Docker runs
 * ffmpeg-static and systemd installs run the installer's build, so the two
 * can differ; a failed probe counts as missing.
 */
export async function probeFfmpegFilter(
  binary: string,
  filter: string,
  run: (
    file: string,
    args: readonly string[],
  ) => Promise<{ stdout: string }> = (file, args) =>
    execFileAsync(file, [...args], { timeout: 10_000, windowsHide: true }),
): Promise<boolean> {
  try {
    const { stdout } = await run(binary, ["-hide_banner", "-filters"]);
    return stdout
      .split("\n")
      .some((line) => line.trim().split(/\s+/)[1] === filter);
  } catch {
    return false;
  }
}

/**
 * Matches the HTTP 403 wording ffmpeg ("Server returned 403 Forbidden") and
 * yt-dlp ("HTTP Error 403: Forbidden") print. A bare /403/ also matched the
 * digits of googlevideo URLs and itags echoed in unrelated errors.
 */
export function isForbiddenResponse(text: string): boolean {
  return /server returned 403|http error 403|\b403 forbidden\b/i.test(text);
}

const FFMPEG_EXIT = "FFmpeg exited with code ";

/** True for an ffmpeg process that died with an error, whatever the cause. */
export function isFfmpegExit(message: string): boolean {
  return message.startsWith(FFMPEG_EXIT);
}

const PCM_BYTES_PER_SECOND = SAMPLE_RATE * CHANNELS * 2;

const FFMPEG_403_RETRY_COUNT = 2;
const FFMPEG_403_RETRY_DELAY_MS = 1_500;

export function createFfmpegPcmStream(
  url: string,
  options: FfmpegPcmOptions = {},
): FfmpegPcmStream {
  const spawnProcess = options.spawnProcess ?? spawn;
  const binary = resolveFfmpegBinary(options.binary);
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
    const env = useProxy
      ? undefined
      : ffmpegEnvironment(options.egressProxyUrl);
    child = spawnProcess(binary, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      ...(env === undefined ? {} : { env }),
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
              `${FFMPEG_EXIT}${code ?? "unknown"}${detail ? `: ${detail}` : ""}`,
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
          `${FFMPEG_EXIT}${code ?? "unknown"}${detail ? `: ${detail}` : ""}`,
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
