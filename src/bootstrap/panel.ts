import { join } from "node:path";

import type { Logger } from "pino";

import { probeTs3Server } from "../adapters/ts3/probe.js";
import type { Ts3Connection } from "../adapters/ts3/ts3-connection.js";
import type { ChatLog } from "../application/chat-log.js";
import type { RadioScrobbler } from "../application/radio-scrobbler.js";
import type { YoutubePlaybackService } from "../application/youtube-playback-service.js";
import {
  normalizeCommandInput,
  parseChatCommand,
} from "../commands/chat-command.js";
import {
  dispatchCommand,
  type CommandContext,
} from "../commands/command-handlers.js";
import type { AppConfig } from "../config.js";
import type { Track } from "../domain/track.js";
import { APP_VERSION } from "../lib/version.js";
import type { RadioTitleCache } from "../media/radio-icy.js";
import type { DaemonHealthSnapshot } from "../media/youtube/daemon-health.js";
import type { YoutubePlaybackResolver } from "../media/youtube/youtube-resolver.js";
import type { MetricsCollector } from "../observability/metrics.js";
import {
  renderPrometheus,
  type PlaybackMetrics,
} from "../observability/prometheus.js";
import {
  createPanelServer,
  type PanelStatus,
  type QueueEntry,
} from "../panel/panel-server.js";
import {
  createCookieSaver,
  createYoutubeHealthCheck,
} from "../panel/youtube-setup.js";
import type { ServerViewSync } from "./server-view.js";

/**
 * Runs a panel command as an admin: the panel is the owner console behind
 * basic auth, so skip/remove on someone else's track must work from there
 * too. "panel" can never collide with a TS3 uid.
 */
export function panelCommandRunner(
  context: CommandContext,
  dispatch: typeof dispatchCommand = dispatchCommand,
): (raw: string) => Promise<string> {
  const adminUids: ReadonlySet<string> = new Set([
    ...context.adminUids,
    "panel",
  ]);
  return async (raw) => {
    const parsed = parseChatCommand(normalizeCommandInput(raw));
    if (parsed === undefined) throw new Error("Comando no valido");
    const responses: string[] = [];
    const send = (text: string): Promise<void> => {
      responses.push(text);
      return Promise.resolve();
    };
    const sender = { groups: [], name: "Panel", uid: "panel" };
    await dispatch({ ...context, adminUids }, parsed, sender, send);
    return responses.join("\n") || "OK";
  };
}

export interface PanelStatusSources {
  readonly connection: Pick<Ts3Connection, "getCurrentChannelId">;
  readonly playback: Pick<
    YoutubePlaybackService,
    | "autoplayEnabled"
    | "current"
    | "loopMode"
    | "playbackPositionMs"
    | "playerState"
    | "queue"
    | "tracksPlayed"
    | "volume"
  >;
  readonly metrics: Pick<MetricsCollector, "disconnectSummary">;
  readonly radioTitles: Pick<RadioTitleCache, "peek">;
  readonly scrobbler: Pick<RadioScrobbler, "confirmedCount">;
  readonly uptimeSeconds?: () => number;
  readonly reconnecting?: () => boolean;
  readonly youtubeAuthHealthy?: () => boolean;
  /** Undefined when no yt-dlp daemon is configured. */
  readonly ytdlpDaemon?: () => DaemonHealthSnapshot | undefined;
}

/** Live radio shows the song the station is playing, not the station. */
function displayTitle(
  current: Track,
  radioTitles: Pick<RadioTitleCache, "peek">,
): string {
  if (current.durationSeconds !== undefined) return current.title;
  return radioTitles.peek(current.source) ?? current.title;
}

export function panelStatus(sources: PanelStatusSources): PanelStatus {
  const { connection, metrics, playback, radioTitles, scrobbler } = sources;
  const channelId = connection.getCurrentChannelId();
  const current = playback.current;
  const uptimeSeconds = sources.uptimeSeconds?.() ?? process.uptime();
  // The channel id is cached by the client and outlives a dropped
  // connection, so it alone reported "connected" during reconnects.
  const reconnecting = sources.reconnecting?.() ?? false;
  const youtubeAuthHealthy = sources.youtubeAuthHealthy?.();
  const ytdlpDaemon = sources.ytdlpDaemon?.();
  return {
    connected: channelId > 0 && !reconnecting,
    reconnecting,
    ...(channelId > 0 ? { currentChannelId: channelId } : {}),
    queueLength: playback.queue().length,
    ...(current === undefined
      ? {}
      : {
          currentTitle: displayTitle(current, radioTitles),
          currentRequester: current.requestedBy,
        }),
    ...(current?.durationSeconds === undefined
      ? {}
      : { durationMs: current.durationSeconds * 1000 }),
    positionMs: playback.playbackPositionMs,
    playerState: playback.playerState,
    volume: playback.volume,
    loopMode: playback.loopMode,
    autoplay: playback.autoplayEnabled,
    // Songs confirmed on live radio count as plays too.
    tracksPlayed: playback.tracksPlayed + scrobbler.confirmedCount,
    uptimeMs: Math.round(uptimeSeconds * 1000),
    disconnects: metrics.disconnectSummary(),
    ...(youtubeAuthHealthy === undefined ? {} : { youtubeAuthHealthy }),
    ...(ytdlpDaemon === undefined ? {} : { ytdlpDaemon }),
    version: APP_VERSION,
  };
}

export interface ConnectedPanelOptions extends PanelStatusSources {
  readonly config: AppConfig;
  readonly dataDir: string;
  readonly logger: Logger;
  readonly connection: Ts3Connection;
  readonly playback: YoutubePlaybackService;
  readonly metrics: MetricsCollector;
  readonly playbackMetrics: PlaybackMetrics;
  readonly chatLog: ChatLog;
  readonly serverView: ServerViewSync;
  readonly resolver: YoutubePlaybackResolver;
  readonly commandContext: CommandContext;
  /** Exit code 1 so systemd (Restart=on-failure) brings the bot back. */
  readonly restart: () => void;
}

export function createBotRenamer(
  config: AppConfig,
  connection: Pick<Ts3Connection, "setNickname">,
  logger: Logger,
): (nickname: string) => Promise<void> {
  return async (nickname) => {
    await connection.setNickname(nickname);
    // Chat echo filtering, !debug and the duplicate-instance check read the
    // nickname from this shared config object, so they follow the rename.
    config.RHAPSOD_TS3_NICKNAME = nickname;
    logger.info({ nickname }, "Bot renamed from the panel");
  };
}

export function startConnectedPanel(
  options: ConnectedPanelOptions,
): { readonly close: () => Promise<void> } | undefined {
  const { config, connection, logger, metrics, playback, serverView } = options;
  if (!config.RHAPSOD_PANEL_ENABLED) return undefined;
  return createPanelServer({
    config,
    envFilePath: config.RHAPSOD_ENV_FILE,
    logger,
    status: () => panelStatus(options),
    queue: (): QueueEntry[] =>
      playback.queue().map((track) => ({
        title: track.title ?? "Sin titulo",
        source: track.source,
        requestedBy: track.requestedBy,
      })),
    errors: () => metrics.errorSummary(20),
    ...(options.commandContext.notices === undefined
      ? {}
      : { notices: options.commandContext.notices }),
    metricsText: () =>
      renderPrometheus({
        counters: metrics.counters(),
        memoryRssBytes: process.memoryUsage.rss(),
        playback: options.playbackMetrics,
        uptimeSeconds: process.uptime(),
        version: APP_VERSION,
        ytdlpDaemon: options.ytdlpDaemon?.(),
      }),
    chat: () => options.chatLog.snapshot(),
    sendChat: (text: string) => connection.sendChannelMessage(text),
    serverView: () => ({
      ...serverView.toJSON(),
      botChannelId: connection.getCurrentChannelId(),
      mode: serverView.mode,
    }),
    moveBot: (cid: number) => connection.moveToChannel(cid),
    renameBot: createBotRenamer(config, connection, logger),
    youtubeHealth: createYoutubeHealthCheck((url, signal) =>
      options.resolver.getAudioUrlFromUrl(url, signal),
    ),
    saveCookies: createCookieSaver(
      config.RHAPSOD_YTDLP_COOKIES_PATH ??
        join(options.dataDir, "youtube-cookies.txt"),
    ),
    executeCommand: panelCommandRunner(options.commandContext),
    restart: (): void => {
      logger.info("Panel requested restart");
      options.restart();
    },
    testConnection: (host: string, port: number) => probeTs3Server(host, port),
  });
}
