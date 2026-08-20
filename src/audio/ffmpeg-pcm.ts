import { spawn, type ChildProcessByStdio } from "node:child_process";
import { PassThrough, type Readable } from "node:stream";

import ffmpegStaticPath from "ffmpeg-static";

import { CHANNELS, SAMPLE_RATE } from "./opus-encoder.js";

export interface FfmpegPcmOptions {
  readonly binary?: string;
  readonly spawnProcess?: typeof spawn;
  readonly loudnessTargetLufs?: number;
  readonly seekSeconds?: number;
  readonly userAgent?: string;
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
    "10",
    "-reconnect_on_network_error",
    "1",
    "-reconnect_on_http_error",
    "4xx,5xx",
    "-max_redirects",
    "0",
    "-rw_timeout",
    "10000000",
  ];
  if (options.userAgent !== undefined && options.userAgent.length > 0) {
    args.push("-user_agent", options.userAgent);
  }
  if (options.seekSeconds !== undefined && options.seekSeconds > 0) {
    args.push("-ss", String(options.seekSeconds));
  }
  args.push("-analyzeduration", "1M", "-probesize", "1M");
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
  if (
    options.loudnessTargetLufs !== undefined &&
    options.loudnessTargetLufs < 0
  ) {
    args.push("-af", `loudnorm=I=${options.loudnessTargetLufs}:TP=-1.5:LRA=11`);
  }
  args.push("pipe:1");
  return args;
}

export function createFfmpegPcmStream(
  url: string,
  options: FfmpegPcmOptions = {},
): FfmpegPcmStream {
  const spawnProcess = options.spawnProcess ?? spawn;
  const child = spawnProcess(
    options.binary ?? ffmpegStaticPath ?? "ffmpeg",
    buildFfmpegPcmArguments(url),
    {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  const stream = new PassThrough({ highWaterMark: 256 * 1024 });
  let stopped = false;
  let stderr = "";

  child.stdout.pipe(stream);
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = `${stderr}${chunk.toString("utf8")}`.slice(-8_192);
  });
  child.on("error", (error) => stream.destroy(error));
  child.on("close", (code, signal) => {
    if (stopped) return;
    if (code === 0 || signal === "SIGTERM") stream.end();
    else {
      const detail = stderr.trim();
      stream.destroy(
        new Error(
          `FFmpeg exited with code ${code ?? "unknown"}${detail ? `: ${detail}` : ""}`,
        ),
      );
    }
  });

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    child.stdout.unpipe(stream);
    stream.end();
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
