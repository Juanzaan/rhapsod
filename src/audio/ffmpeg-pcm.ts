import { spawn, type ChildProcessByStdio } from "node:child_process";
import { PassThrough, type Readable } from "node:stream";

import ffmpegStaticPath from "ffmpeg-static";

import { CHANNELS, SAMPLE_RATE } from "./opus-encoder.js";
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
  readonly userAgent?: string;
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

export function buildFfmpegPcmArguments(
  url: string,
  options: FfmpegPcmOptions = {},
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

  const start = (): void => {
    const args = buildFfmpegPcmArguments(url, options);
    stderr = "";
    child = spawnProcess(binary, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout.pipe(stream, { end: false });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-8_192);
    });
    child.on("error", (error) => {
      if (!stopped && !stream.destroyed) stream.destroy(error);
    });
    child.on("close", (code, signal) => {
      console.error(
        JSON.stringify({
          msg: "FFmpeg close",
          code,
          signal,
          stopped,
          retries,
          url: url.slice(0, 80),
          stderr: stderr.trim().slice(0, 200),
        }),
      );
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
      if (/403|Forbidden/i.test(stderr) && retries < FFMPEG_403_RETRY_COUNT) {
        retries++;
        const timer = setTimeout(start, FFMPEG_403_RETRY_DELAY_MS);
        timer.unref();
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
