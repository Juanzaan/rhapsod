import { join } from "node:path";

import type { Logger } from "pino";

import { probeTs3Server } from "../adapters/ts3/probe.js";
import type { AppConfig } from "../config.js";
import { APP_VERSION } from "../lib/version.js";
import { createYtDlpResolverStack } from "../media/youtube/yt-dlp.js";
import { createPanelServer, type QueueEntry } from "../panel/panel-server.js";
import {
  createCookieSaver,
  createYoutubeHealthCheck,
} from "../panel/youtube-setup.js";
import { onStopSignal, type ExitCoordinator } from "./exit.js";
import { ytDlpStackOptions } from "./yt-dlp-options.js";

export interface SetupModeOptions {
  readonly config: AppConfig;
  readonly dataDir: string;
  readonly logger: Logger;
  readonly exits: ExitCoordinator;
}

/**
 * The installer ships AUTO_CONNECT=false so the bot can boot before any
 * TeamSpeak host is configured. The wizard that collects the host is served
 * by the panel, so the panel comes up here without TeamSpeak.
 */
export function startSetupMode(options: SetupModeOptions): void {
  const { config, dataDir, exits, logger } = options;
  if (!config.RHAPSOD_PANEL_ENABLED) return;
  const { resolver } = createYtDlpResolverStack(
    logger,
    ytDlpStackOptions(config),
  );
  const panel = createPanelServer({
    config,
    envFilePath: config.RHAPSOD_ENV_FILE,
    logger,
    status: () => ({
      connected: false,
      queueLength: 0,
      playerState: "idle" as const,
      uptimeMs: Math.round(process.uptime() * 1000),
      version: APP_VERSION,
    }),
    queue: (): QueueEntry[] => [],
    executeCommand: (): Promise<string> =>
      Promise.reject(new Error("El bot no esta conectado a TeamSpeak todavia")),
    youtubeHealth: createYoutubeHealthCheck((url, signal) =>
      resolver.getAudioUrlFromUrl(url, signal),
    ),
    saveCookies: createCookieSaver(
      config.RHAPSOD_YTDLP_COOKIES_PATH ?? join(dataDir, "youtube-cookies.txt"),
    ),
    restart: (): void => {
      logger.info("Panel requested restart");
      void exits.exit(1);
    },
    testConnection: (host: string, port: number) => probeTs3Server(host, port),
  });
  logger.info(
    "Setup mode: panel running without TeamSpeak; complete the wizard and restart",
  );
  // Without these, `systemctl stop` during setup killed the process with the
  // panel open and the log unflushed.
  onStopSignal(() => {
    logger.info("Shutdown initiated in setup mode");
    exits.setFlush(() => panel.close().catch(() => undefined));
    void exits.exit(0);
  });
}
