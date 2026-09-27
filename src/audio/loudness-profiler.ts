import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { ffmpegEgressArguments, ffmpegEnvironment } from "./ffmpeg-pcm.js";

const execFileAsync = promisify(execFile);

const DEFAULT_BINARY = "ffmpeg";
const MEASURE_TTL_MS = 24 * 60 * 60 * 1000;
// A failed measurement (timeout, 403, DRM) is not retried on every prefetch
// of the same track: each attempt can hold an ffmpeg download for 180 s.
const FAILURE_RETRY_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 500;
const MAX_CONCURRENT = 2;
// Linear two-pass gain is only safe when the true peak it checks covers the
// whole track: a 120 s sample of a quiet intro let the gain clip a louder
// chorus. Longer tracks (mixes, podcasts) keep the dynamic filter.
const MAX_MEASURED_SECONDS = 15 * 60;

export interface LoudnessProfile {
  readonly measuredI: number;
  readonly measuredTp: number;
  readonly measuredLra: number;
  readonly measuredThresh: number;
}

export interface LoudnessProfilerOptions {
  readonly binary?: string;
  readonly execFile?: (
    file: string,
    args: readonly string[],
    options: {
      maxBuffer: number;
      timeout: number;
      windowsHide: boolean;
      env?: NodeJS.ProcessEnv;
    },
  ) => Promise<{ stderr: string; stdout: string }>;
  readonly targetLufs?: number;
  /** Local egress guard; see lib/egress-guard.ts. */
  readonly egressProxyUrl?: string;
}

/**
 * Reads loudnorm's pass-1 report out of ffmpeg's stderr. ffmpeg prints every
 * value as a string ("-13.42"), and "-inf" for silent input, which has no
 * usable profile.
 */
function parseLoudnessReport(stderr: string): LoudnessProfile | undefined {
  const json = stderr.match(/\{\s*"input_i"[\s\S]*?\}/)?.[0];
  if (json === undefined) return undefined;
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const measuredI = Number(parsed.input_i);
    const measuredTp = Number(parsed.input_tp);
    const measuredLra = Number(parsed.input_lra);
    const measuredThresh = Number(parsed.input_thresh);
    if (
      [measuredI, measuredTp, measuredLra, measuredThresh].every((value) =>
        Number.isFinite(value),
      )
    ) {
      return { measuredI, measuredLra, measuredThresh, measuredTp };
    }
  } catch {
    // The measurement did not produce usable JSON.
  }
  return undefined;
}

export class LoudnessProfiler {
  readonly #binary: string;
  readonly #targetLufs: number;
  readonly #execFile: NonNullable<LoudnessProfilerOptions["execFile"]>;
  readonly #egressProxyUrl: string | undefined;
  readonly #profiles = new Map<
    string,
    { profile: LoudnessProfile; expiresAt: number }
  >();
  readonly #measuring = new Set<string>();
  readonly #failedUntil = new Map<string, number>();
  #activeMeasurements = 0;

  constructor(options: LoudnessProfilerOptions = {}) {
    this.#binary = options.binary ?? DEFAULT_BINARY;
    this.#targetLufs = options.targetLufs ?? -14;
    this.#execFile = options.execFile ?? execFileAsync;
    this.#egressProxyUrl = options.egressProxyUrl;
  }

  /** The LUFS target handed to ffmpeg; used for prewarm option parity. */
  get targetLufs(): number {
    return this.#targetLufs;
  }

  cached(source: string): LoudnessProfile | undefined {
    const entry = this.#profiles.get(source);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.#profiles.delete(source);
      return undefined;
    }
    return entry.profile;
  }

  /**
   * startSeconds skips a non-music intro, which would otherwise pull the
   * measured loudness toward speech level.
   */
  measure(
    source: string,
    url: string,
    durationSeconds: number,
    startSeconds?: number,
  ): void {
    if (durationSeconds > MAX_MEASURED_SECONDS) return;
    if (this.cached(source) !== undefined) return;
    if (this.#measuring.has(source)) return;
    const retryAt = this.#failedUntil.get(source);
    if (retryAt !== undefined) {
      if (retryAt > Date.now()) return;
      this.#failedUntil.delete(source);
    }
    if (this.#activeMeasurements >= MAX_CONCURRENT) return;
    this.#measuring.add(source);
    this.#activeMeasurements++;
    void this.#measureImpl(source, url, startSeconds).finally(() => {
      this.#measuring.delete(source);
      this.#activeMeasurements--;
    });
  }

  async #measureImpl(
    source: string,
    url: string,
    startSeconds: number | undefined,
  ): Promise<void> {
    let stderr: string;
    const env = ffmpegEnvironment(this.#egressProxyUrl);
    try {
      const { stderr: output } = await this.#execFile(
        this.#binary,
        [
          "-hide_banner",
          "-nostats",
          // loudnorm prints its report at info level: with "error" it never
          // appeared and no track was ever measured.
          "-loglevel",
          "info",
          "-nostdin",
          ...ffmpegEgressArguments(this.#egressProxyUrl),
          ...(startSeconds !== undefined && startSeconds > 0
            ? ["-ss", String(startSeconds)]
            : []),
          "-i",
          url,
          "-af",
          `loudnorm=I=${this.#targetLufs}:TP=-1.5:LRA=11:print_format=json`,
          "-f",
          "null",
          "-",
        ],
        {
          maxBuffer: 4 * 1024 * 1024,
          timeout: 180_000,
          windowsHide: true,
          ...(env === undefined ? {} : { env }),
        },
      );
      stderr = output;
    } catch {
      // A failed measurement (network, DRM, non-embeddable) is not fatal;
      // playback falls back to the single-pass filter.
      this.#recordFailure(source);
      return;
    }
    const profile = parseLoudnessReport(stderr);
    if (profile === undefined) {
      this.#recordFailure(source);
      return;
    }
    this.#profiles.set(source, {
      expiresAt: Date.now() + MEASURE_TTL_MS,
      profile,
    });
    if (this.#profiles.size > MAX_ENTRIES) {
      const oldest = this.#profiles.keys().next().value;
      if (oldest !== undefined) this.#profiles.delete(oldest);
    }
  }

  #recordFailure(source: string): void {
    this.#failedUntil.set(source, Date.now() + FAILURE_RETRY_MS);
    if (this.#failedUntil.size > MAX_ENTRIES) {
      const oldest = this.#failedUntil.keys().next().value;
      if (oldest !== undefined) this.#failedUntil.delete(oldest);
    }
  }
}
