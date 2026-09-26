import type { AppConfig } from "../config.js";
import { timeoutConfigFrom } from "../lib/timeout-config.js";
import type { YtDlpResolverStackOptions } from "../media/youtube/yt-dlp.js";

/** yt-dlp settings shared by setup mode and the full bot. */
export function ytDlpStackOptions(
  config: AppConfig,
): YtDlpResolverStackOptions {
  return {
    ytdlpPath: config.RHAPSOD_YTDLP_PATH,
    ...(config.RHAPSOD_YTDLP_COOKIES_PATH === undefined
      ? {}
      : { cookiesPath: config.RHAPSOD_YTDLP_COOKIES_PATH }),
    ...(config.RHAPSOD_YTDLP_EXTRACTOR_ARGS === undefined
      ? {}
      : { extractorArgs: config.RHAPSOD_YTDLP_EXTRACTOR_ARGS }),
    ...(config.RHAPSOD_YTDLP_DAEMON_URL === undefined
      ? {}
      : { daemonUrl: config.RHAPSOD_YTDLP_DAEMON_URL }),
    timeouts: timeoutConfigFrom(config),
  };
}
