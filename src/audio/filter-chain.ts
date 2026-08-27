export type AudioFilter =
  "off" | "bassboost" | "nightcore" | "vaporwave" | "8d";

export const AUDIO_FILTERS: readonly AudioFilter[] = [
  "off",
  "bassboost",
  "nightcore",
  "vaporwave",
  "8d",
];

export const BASSOOST_LEVEL_MIN = 1;
export const BASSOOST_LEVEL_MAX = 5;
export const NIGHTCORE_RATE_MIN = 1.05;
export const NIGHTCORE_RATE_MAX = 1.35;
export const VAPORWAVE_RATE_MIN = 0.8;
export const VAPORWAVE_RATE_MAX = 0.95;

export const FILTER_DISPLAY_NAMES: Record<AudioFilter, string> = {
  off: "off",
  bassboost: "bassboost",
  nightcore: "nightcore",
  vaporwave: "vaporwave",
  "8d": "8D",
};

export interface FilterParam {
  readonly level?: number;
  readonly rate?: number;
}

const SAMPLE_RATE = 48_000;
const BASSOOST_GAINS = [4, 6, 9, 12, 15];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteOr(raw: number | undefined, fallback: number): number {
  return raw !== undefined && Number.isFinite(raw) ? raw : fallback;
}

export function isAudioFilter(value: unknown): value is AudioFilter {
  return (
    typeof value === "string" &&
    (AUDIO_FILTERS as readonly string[]).includes(value)
  );
}

export function buildFilterChain(
  filter: AudioFilter,
  param?: FilterParam,
): string | undefined {
  switch (filter) {
    case "off":
      return undefined;
    case "bassboost": {
      const level = clamp(
        Math.round(finiteOr(param?.level, 2)),
        BASSOOST_LEVEL_MIN,
        BASSOOST_LEVEL_MAX,
      );
      const gain = BASSOOST_GAINS[level - 1] ?? 6;
      return `bass=g=${gain}:f=110:w=0.6`;
    }
    case "nightcore": {
      const rate = clamp(
        finiteOr(param?.rate, 1.15),
        NIGHTCORE_RATE_MIN,
        NIGHTCORE_RATE_MAX,
      );
      return `asetrate=${Math.round(SAMPLE_RATE * rate)},aresample=${SAMPLE_RATE}`;
    }
    case "vaporwave": {
      const rate = clamp(
        finiteOr(param?.rate, 0.85),
        VAPORWAVE_RATE_MIN,
        VAPORWAVE_RATE_MAX,
      );
      return `asetrate=${Math.round(SAMPLE_RATE * rate)},aresample=${SAMPLE_RATE},aecho=0.8:0.85:60|120:0.4|0.25`;
    }
    case "8d":
      return "apulsator=hz=0.125:width=1";
  }
}
