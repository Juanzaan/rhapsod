import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_BINARY = "ffmpeg";
const MEASURE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;
const MAX_CONCURRENT = 2;
const SAMPLE_SECONDS = 120;

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
    },
  ) => Promise<{ stdout: string }>;
  readonly targetLufs?: number;
}

function parseProfile(json: string): LoudnessProfile | undefined {
  try {
    const parsed = JSON.parse(json) as {
      input_i?: number;
      input_tp?: number;
      input_lra?: number;
      input_thresh?: number;
    };
    const { input_i, input_tp, input_lra, input_thresh } = parsed;
    if (
      typeof input_i === "number" &&
      typeof input_tp === "number" &&
      typeof input_lra === "number" &&
      typeof input_thresh === "number"
    ) {
      return {
        measuredI: input_i,
        measuredLra: input_lra,
        measuredThresh: input_thresh,
        measuredTp: input_tp,
      };
    }
  } catch {
    // The measurement did not produce usable JSON.
  }
  return undefined;
}

export class LoudnessProfiler {
  readonly #binary: string;
  readonly #targetLufs: number;
  readonly #execFile: (
    file: string,
    args: readonly string[],
    options: {
      maxBuffer: number;
      timeout: number;
      windowsHide: boolean;
    },
  ) => Promise<{ stdout: string }>;
  readonly #profiles = new Map<
    string,
    { profile: LoudnessProfile; expiresAt: number }
  >();
  readonly #measuring = new Set<string>();
  #activeMeasurements = 0;

  constructor(options: LoudnessProfilerOptions = {}) {
    this.#binary = options.binary ?? DEFAULT_BINARY;
    this.#targetLufs = options.targetLufs ?? -14;
    this.#execFile = options.execFile ?? execFileAsync;
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

  measure(source: string, url: string): void {
    if (this.cached(source) !== undefined) return;
    if (this.#measuring.has(source)) return;
    if (this.#activeMeasurements >= MAX_CONCURRENT) return;
    this.#measuring.add(source);
    this.#activeMeasurements++;
    void this.#measureImpl(source, url).finally(() => {
      this.#measuring.delete(source);
      this.#activeMeasurements--;
    });
  }

  async #measureImpl(source: string, url: string): Promise<void> {
    let stdout: string;
    try {
      const { stdout: output } = await this.#execFile(
        this.#binary,
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-nostdin",
          "-t",
          String(SAMPLE_SECONDS),
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
          timeout: 90_000,
          windowsHide: true,
        },
      );
      stdout = output;
    } catch {
      // A failed measurement (network, DRM, non-embeddable) is not fatal;
      // playback falls back to the single-pass filter.
      return;
    }
    const json = stdout.match(/\{[\s\S]*\}/)?.[0];
    const profile = json ? parseProfile(json) : undefined;
    if (profile === undefined) return;
    this.#profiles.set(source, {
      expiresAt: Date.now() + MEASURE_TTL_MS,
      profile,
    });
    if (this.#profiles.size > MAX_ENTRIES) {
      const oldest = this.#profiles.keys().next().value;
      if (oldest !== undefined) this.#profiles.delete(oldest);
    }
  }
}
