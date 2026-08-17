import { spawn, type ChildProcessByStdio } from "node:child_process";
import { PassThrough, type Readable } from "node:stream";

import { CHANNELS, SAMPLE_RATE } from "./opus-encoder.js";

export interface FfmpegPcmOptions {
  readonly binary?: string;
  readonly spawnProcess?: typeof spawn;
}

export interface FfmpegPcmStream {
  readonly stream: PassThrough;
  readonly process: ChildProcessByStdio<null, Readable, Readable>;
  stop(): void;
}

export function buildFfmpegPcmArguments(url: string): string[] {
  if (!/^https:\/\//i.test(url)) {
    throw new Error("FFmpeg audio input must use HTTPS");
  }

  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-reconnect",
    "1",
    "-reconnect_at_eof",
    "1",
    "-reconnect_streamed",
    "1",
    "-reconnect_delay_max",
    "10",
    "-reconnect_on_network_error",
    "1",
    "-reconnect_on_http_error",
    "4xx,5xx",
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
    "pipe:1",
  ];
}

export function createFfmpegPcmStream(
  url: string,
  options: FfmpegPcmOptions = {},
): FfmpegPcmStream {
  const spawnProcess = options.spawnProcess ?? spawn;
  const child = spawnProcess(
    options.binary ?? "ffmpeg",
    buildFfmpegPcmArguments(url),
    {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  const stream = new PassThrough({ highWaterMark: 256 * 1024 });
  let stopped = false;

  child.stdout.pipe(stream);
  child.stderr.on("data", () => undefined);
  child.on("error", (error) => stream.destroy(error));
  child.on("close", (code, signal) => {
    if (stopped) return;
    if (code === 0 || signal === "SIGTERM") stream.end();
    else
      stream.destroy(new Error(`FFmpeg exited with code ${code ?? "unknown"}`));
  });

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    child.stdout.unpipe(stream);
    stream.end();
    child.kill("SIGTERM");
  };

  stream.once("close", () => {
    if (!stopped) stop();
  });

  return { process: child, stop, stream };
}
