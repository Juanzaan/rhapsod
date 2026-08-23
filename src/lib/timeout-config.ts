export interface TimeoutConfig {
  readonly search: number;
  readonly audioUrl: number;
  readonly download: number;
  readonly metadata: number;
  readonly playlist: number;
}

interface TimeoutRange {
  readonly min: number;
  readonly max: number;
  readonly default_: number;
}

const TIMEOUT_RANGES: Record<keyof TimeoutConfig, TimeoutRange> = {
  search: { min: 4000, max: 20000, default_: 8000 },
  audioUrl: { min: 5000, max: 30000, default_: 12000 },
  download: { min: 30000, max: 300000, default_: 60000 },
  metadata: { min: 10000, max: 60000, default_: 30000 },
  playlist: { min: 15000, max: 120000, default_: 45000 },
};

const ENV_KEYS: Record<keyof TimeoutConfig, string> = {
  search: "RHAPSOD_YTDLP_SEARCH_TIMEOUT_MS",
  audioUrl: "RHAPSOD_YTDLP_AUDIO_URL_TIMEOUT_MS",
  download: "RHAPSOD_YTDLP_DOWNLOAD_TIMEOUT_MS",
  metadata: "RHAPSOD_YTDLP_METADATA_TIMEOUT_MS",
  playlist: "RHAPSOD_YTDLP_PLAYLIST_TIMEOUT_MS",
};

function parseAndValidate(
  key: keyof TimeoutConfig,
  raw: string | undefined,
): number {
  const range = TIMEOUT_RANGES[key];
  if (raw === undefined || raw.length === 0) return range.default_;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(
      `[rhapsod] Invalid timeout for ${ENV_KEYS[key]}: "${raw}". Using default ${range.default_}ms.`,
    );
    return range.default_;
  }

  const clamped = Math.round(parsed);
  if (clamped < range.min) {
    console.warn(
      `[rhapsod] Timeout ${ENV_KEYS[key]}=${clamped}ms is below minimum ${range.min}ms. Using ${range.min}ms.`,
    );
    return range.min;
  }
  if (clamped > range.max) {
    console.warn(
      `[rhapsod] Timeout ${ENV_KEYS[key]}=${clamped}ms is above maximum ${range.max}ms. Using ${range.max}ms.`,
    );
    return range.max;
  }

  return clamped;
}

export function getTimeoutConfig(
  env?: Record<string, string | undefined>,
): TimeoutConfig {
  const e = env ?? process.env;
  return {
    search: parseAndValidate("search", e[ENV_KEYS.search]),
    audioUrl: parseAndValidate("audioUrl", e[ENV_KEYS.audioUrl]),
    download: parseAndValidate("download", e[ENV_KEYS.download]),
    metadata: parseAndValidate("metadata", e[ENV_KEYS.metadata]),
    playlist: parseAndValidate("playlist", e[ENV_KEYS.playlist]),
  };
}
