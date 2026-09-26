import type { AppConfig } from "../config.js";

export interface TimeoutConfig {
  readonly search: number;
  readonly audioUrl: number;
  readonly download: number;
  readonly metadata: number;
  readonly playlist: number;
}

export function timeoutConfigFrom(
  config: Pick<
    AppConfig,
    | "RHAPSOD_YTDLP_AUDIO_URL_TIMEOUT_MS"
    | "RHAPSOD_YTDLP_DOWNLOAD_TIMEOUT_MS"
    | "RHAPSOD_YTDLP_METADATA_TIMEOUT_MS"
    | "RHAPSOD_YTDLP_PLAYLIST_TIMEOUT_MS"
    | "RHAPSOD_YTDLP_SEARCH_TIMEOUT_MS"
  >,
): TimeoutConfig {
  return {
    search: config.RHAPSOD_YTDLP_SEARCH_TIMEOUT_MS,
    audioUrl: config.RHAPSOD_YTDLP_AUDIO_URL_TIMEOUT_MS,
    download: config.RHAPSOD_YTDLP_DOWNLOAD_TIMEOUT_MS,
    metadata: config.RHAPSOD_YTDLP_METADATA_TIMEOUT_MS,
    playlist: config.RHAPSOD_YTDLP_PLAYLIST_TIMEOUT_MS,
  };
}
