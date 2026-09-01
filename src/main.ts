import "dotenv/config";

import { join } from "node:path";

import { Ts3IdentityStore } from "./adapters/ts3/identity-store.js";
import { createTs3Connection } from "./adapters/ts3/ts3-connection.js";
import { createRhapsodOpusEncoder } from "./audio/opus-encoder.js";
import { playFfmpegUrl } from "./audio/ffmpeg-player.js";
import { LoudnessProfiler } from "./audio/loudness-profiler.js";
import { playTestTone } from "./audio/test-tone-player.js";
import { YoutubePlaybackService } from "./application/youtube-playback-service.js";
import { AudioUrlCache } from "./application/audio-url-cache.js";
import { PlaylistStore } from "./application/playlist-store.js";
import { UserTelemetry } from "./application/user-telemetry.js";
import { parseChatCommand } from "./commands/chat-command.js";
import {
  dispatchCommand,
  type CommandContext,
} from "./commands/command-handlers.js";
import { formatPlaybackError, formatPlaybackStarted } from "./lib/messages.js";
import { classifyYoutubeAuthFailure } from "./lib/youtube-auth-health.js";
import { CommandRateLimiter } from "./commands/command-rate-limiter.js";
import { loadConfig } from "./config.js";
import { FilePlaybackStateStore } from "./domain/state-store.js";
import {
  parseAdminUids,
  parseChannelIds,
  parseMoveGroupIds,
} from "./commands/permissions.js";
import {
  SystemYtDlpExecutor,
  YoutubeResolver,
} from "./media/youtube/yt-dlp.js";
import { getTimeoutConfig } from "./lib/timeout-config.js";
import { UserError } from "./lib/user-error.js";
import { createPanelServer, type QueueEntry } from "./panel/panel-server.js";
import type { YoutubePlaybackResolver } from "./media/youtube/youtube-resolver.js";
import { RedirectResolver } from "./media/redirect-resolver.js";
import { SongLinkClient } from "./media/song-link.js";
import { DirectUrlClient } from "./media/direct-url.js";
import { LyricsClient } from "./media/lyrics.js";
import { SoundCloudPublicApi } from "./media/soundcloud/public-api.js";
import { SpotifyApi } from "./media/spotify/api.js";
import { createRhapsodLogger } from "./observability/logger.js";
import { MetricsCollector } from "./observability/metrics.js";
import { startWatchdog } from "./watchdog.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = await createRhapsodLogger({
    level: config.RHAPSOD_LOG_LEVEL,
    logDir: join(config.RHAPSOD_DATA_DIR, "logs"),
    retentionDays: config.RHAPSOD_LOG_RETENTION_DAYS,
  });
  const metrics = new MetricsCollector();
  const trackTimings = new Map<
    string,
    { audioUrlMs?: number; cacheHit?: boolean; metadataMs?: number }
  >();
  const setTrackTiming = (
    trackId: string,
    timing: { audioUrlMs?: number; cacheHit?: boolean; metadataMs?: number },
  ): void => {
    trackTimings.set(trackId, timing);
    if (trackTimings.size > 200) {
      const oldest = trackTimings.keys().next().value;
      if (oldest !== undefined) trackTimings.delete(oldest);
    }
  };
  process.on("unhandledRejection", (reason: unknown) => {
    logger.error({ reason }, "Unhandled promise rejection; restarting");
    process.exit(1);
  });
  process.on("uncaughtException", (error: Error) => {
    logger.error({ error }, "Uncaught exception; restarting");
    process.exit(1);
  });
  const adminUids = parseAdminUids(config.RHAPSOD_ADMIN_UIDS);
  const privateCommandUids =
    config.RHAPSOD_PRIVATE_COMMAND_UIDS === undefined ||
    config.RHAPSOD_PRIVATE_COMMAND_UIDS === ""
      ? adminUids
      : parseAdminUids(config.RHAPSOD_PRIVATE_COMMAND_UIDS);
  const verbose = config.RHAPSOD_VERBOSE;
  const moveGroupIds = parseMoveGroupIds(config.RHAPSOD_MOVE_GROUP_IDS);
  const adminGroupIds = parseMoveGroupIds(config.RHAPSOD_MOVE_ADMIN_GROUP_IDS);
  const seniorGroupIds =
    config.RHAPSOD_MOVE_SENIOR_GROUP_IDS === undefined ||
    config.RHAPSOD_MOVE_SENIOR_GROUP_IDS === ""
      ? adminGroupIds
      : parseMoveGroupIds(config.RHAPSOD_MOVE_SENIOR_GROUP_IDS);
  const adminChannelIds = parseChannelIds(config.RHAPSOD_MOVE_ADMIN_CHANNELS);
  const seniorChannelIds = parseChannelIds(config.RHAPSOD_MOVE_SENIOR_CHANNELS);

  logger.info(
    {
      host: config.RHAPSOD_TS3_HOST,
      nickname: config.RHAPSOD_TS3_NICKNAME,
      port: config.RHAPSOD_TS3_PORT,
    },
    "Rhapsod configuration loaded",
  );
  if (!config.RHAPSOD_TS3_AUTO_CONNECT) {
    logger.info("TeamSpeak 3 auto-connect is disabled");
    return;
  }

  const identity = await new Ts3IdentityStore(
    join(config.RHAPSOD_DATA_DIR, "ts3-identity.txt"),
  ).loadOrCreate();
  const metricsIntervalMinutes = config.RHAPSOD_METRICS_INTERVAL_MINUTES;
  const ytDlpMetricsRef = {
    getMetrics: (): {
      active: number;
      queued: number;
      totalRuns: number;
    } => ({ active: 0, queued: 0, totalRuns: 0 }),
  };
  if (metricsIntervalMinutes > 0) {
    const reportMetrics = (): void => {
      const { heapUsed, rss } = process.memoryUsage();
      const ytdlp = ytDlpMetricsRef.getMetrics();
      metrics.setGauge("ytdlpActiveJobs", ytdlp.active);
      metrics.setGauge("ytdlpQueuedJobs", ytdlp.queued);
      metrics.setGauge("ytdlpTotalRuns", ytdlp.totalRuns);
      logger.info(
        {
          ...metrics.counters(),
          heapUsedMb: Math.round(heapUsed / 1_048_576),
          rssMb: Math.round(rss / 1_048_576),
        },
        "Process metrics",
      );
    };
    reportMetrics();
    setInterval(reportMetrics, metricsIntervalMinutes * 60_000).unref();
  }
  if (config.RHAPSOD_WATCHDOG_INTERVAL_MINUTES > 0) {
    startWatchdog({
      intervalMs: config.RHAPSOD_WATCHDOG_INTERVAL_MINUTES * 60_000,
      onTimeout: (driftMs) => {
        logger.error({ driftMs }, "Watchdog: event loop blocked; restarting");
        process.exit(1);
      },
    });
  }
  const connection = createTs3Connection(config, identity, logger);
  const telemetry = new UserTelemetry(
    join(config.RHAPSOD_DATA_DIR, "user-telemetry.json"),
    logger,
  );
  telemetry.load();
  setInterval(() => {
    telemetry.logSummary("periodic");
    void telemetry.save();
  }, 15 * 60_000).unref();
  const maxReconnectAttempts = 5;
  const encoder = await createRhapsodOpusEncoder({
    bitrate: config.RHAPSOD_OPUS_BITRATE,
    complexity: config.RHAPSOD_OPUS_COMPLEXITY,
    packetLossPercent: config.RHAPSOD_OPUS_PACKET_LOSS_PERCENT,
  });
  const spotifyResolver =
    config.RHAPSOD_SPOTIFY_CLIENT_ID && config.RHAPSOD_SPOTIFY_CLIENT_SECRET
      ? new SpotifyApi({
          clientId: config.RHAPSOD_SPOTIFY_CLIENT_ID,
          clientSecret: config.RHAPSOD_SPOTIFY_CLIENT_SECRET,
          ...(config.RHAPSOD_SPOTIFY_REFRESH_TOKEN === undefined
            ? {}
            : { refreshToken: config.RHAPSOD_SPOTIFY_REFRESH_TOKEN }),
          logger,
        })
      : undefined;
  const ffmpegPath = config.RHAPSOD_FFMPEG_PATH;
  const ffmpegUserAgent = config.RHAPSOD_FFMPEG_USER_AGENT;
  const loudnessProfiler = new LoudnessProfiler({
    ...(ffmpegPath === undefined ? {} : { binary: ffmpegPath }),
    targetLufs: config.RHAPSOD_LOUDNESS_TARGET_LUFS,
  });
  const ytDlpExecutor = new SystemYtDlpExecutor(
    config.RHAPSOD_YTDLP_PATH,
    config.RHAPSOD_YTDLP_COOKIES_PATH,
    {
      ...(config.RHAPSOD_MAX_CONCURRENT_YTDLP_JOBS === undefined
        ? {}
        : { maxConcurrentJobs: config.RHAPSOD_MAX_CONCURRENT_YTDLP_JOBS }),
    },
    logger,
    config.RHAPSOD_YTDLP_EXTRACTOR_ARGS,
  );
  ytDlpMetricsRef.getMetrics = () => ytDlpExecutor.metrics();
  const audioUrlCache = AudioUrlCache.load(
    join(config.RHAPSOD_DATA_DIR, "audio-url-cache.json"),
    logger,
    {
      onHit: () => metrics.increment("cacheHits"),
      onMiss: () => metrics.increment("cacheMisses"),
    },
  );
  const ytDlpResolver = new YoutubeResolver(ytDlpExecutor, logger, {
    onSearchMetrics: (m) => metrics.recordSearchMetrics(m),
    timeouts: getTimeoutConfig(),
    ...(config.RHAPSOD_YTDLP_DAEMON_URL === undefined
      ? {}
      : { daemonUrl: config.RHAPSOD_YTDLP_DAEMON_URL }),
  });
  const resolver: YoutubePlaybackResolver = ytDlpResolver;
  const playback = new YoutubePlaybackService({
    createPlayback: (url, playbackEncoder, output, options) =>
      playFfmpegUrl(url, playbackEncoder, output, {
        ...(ffmpegPath === undefined ? {} : { binary: ffmpegPath }),
        loudnessTargetLufs: config.RHAPSOD_LOUDNESS_TARGET_LUFS,
        ...(ffmpegUserAgent === undefined
          ? {}
          : { userAgent: ffmpegUserAgent }),
        ...(options?.seekSeconds === undefined
          ? {}
          : { seekSeconds: options.seekSeconds }),
        ...(options?.audioFilter === undefined
          ? {}
          : { audioFilter: options.audioFilter }),
        ...(options?.stream === undefined ? {} : { stream: options.stream }),
      }),
    prewarmNext: true,
    loudnessProfiler,
    encoder,
    onPlaybackStarted: async (track) => {
      const timings = trackTimings.get(track.id);
      logger.info(
        { ...timings, trackId: track.id, title: track.title },
        "Playback started",
      );
      const isFirst = !commandContext.hasStartedPlaying;
      commandContext.hasStartedPlaying = true;
      await connection.sendChannelMessage(
        formatPlaybackStarted(track.title, isFirst),
      );
    },
    onPlaybackFinished: (track, metrics, reason) => {
      const timings = trackTimings.get(track.id);
      trackTimings.delete(track.id);
      logger.info(
        {
          ...timings,
          ...metrics,
          reason,
          trackId: track.id,
          title: track.title,
        },
        "Playback session",
      );
    },
    onTiming: (timing) => {
      setTrackTiming(timing.trackId, {
        ...(timing.stage === "metadata"
          ? { metadataMs: timing.durationMs }
          : {}),
        ...(timing.stage === "audio-url"
          ? {
              audioUrlMs: timing.durationMs,
              ...(timing.cacheHit === undefined
                ? {}
                : { cacheHit: timing.cacheHit }),
            }
          : {}),
      });
      if (timing.stage === "audio-url") {
        const s = timing.prefetchStatus;
        if (s === "hit") metrics.increment("prefetchHits");
        else if (s === "in-flight") metrics.increment("prefetchInFlight");
        else if (s === "miss") metrics.increment("prefetchMisses");
      }
      metrics.recordTiming(timing);
      logger.info(timing, "Playback timing");
    },
    onPlaybackError: async (track, error) => {
      metrics.recordError(track.id, error);
      logger.error(
        { err: error, trackId: track.id },
        "YouTube playback failed",
      );
      await connection.sendChannelMessage(formatPlaybackError(track.title));
    },
    output: connection,
    resolver,
    stateStore: new FilePlaybackStateStore(
      join(config.RHAPSOD_DATA_DIR, "state.json"),
      logger,
    ),
    audioUrlCache,
    redirectResolver: new RedirectResolver(),
    playlistStore: new PlaylistStore(
      join(config.RHAPSOD_DATA_DIR, "playlists.json"),
      logger,
    ),
    maxQueueTracks: config.RHAPSOD_MAX_QUEUE_TRACKS,
    maxTracksPerUser: config.RHAPSOD_MAX_TRACKS_PER_USER,
    alternativeResolver: new SongLinkClient({ logger }),
    directUrlResolver: new DirectUrlClient({
      ...(config.RHAPSOD_FFPROBE_PATH === undefined
        ? {}
        : { ffprobeBinary: config.RHAPSOD_FFPROBE_PATH }),
    }),
    soundcloudResolver: new SoundCloudPublicApi({ logger }),
    lyricsResolver: new LyricsClient({ logger }),
    ...(spotifyResolver ? { spotifyResolver } : {}),
  });
  const youtubeAuthCheckUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  const youtubeAuthCheckIntervalMs = 24 * 60 * 60 * 1_000;
  const youtubeAuthState = { healthy: true };
  const checkYoutubeAuth = async (): Promise<void> => {
    try {
      await ytDlpExecutor.run(
        ["--get-url", "--no-playlist", "--no-warnings", youtubeAuthCheckUrl],
        25_000,
        "metadata",
      );
      if (!youtubeAuthState.healthy) {
        logger.info("YouTube authentication recovered");
        youtubeAuthState.healthy = true;
      }
    } catch (error) {
      if (youtubeAuthState.healthy) {
        const category = classifyYoutubeAuthFailure(error);
        logger.error(
          { err: error, category },
          "YouTube authentication health check FAILED",
        );
      }
      youtubeAuthState.healthy = false;
    }
  };
  setInterval(
    () => void checkYoutubeAuth(),
    youtubeAuthCheckIntervalMs,
  ).unref();
  void checkYoutubeAuth();
  const commandRateLimiter = new CommandRateLimiter();
  const commandContext: CommandContext = {
    playback,
    connection,
    config,
    adminUids,
    moveGroupIds,
    adminGroupIds,
    seniorGroupIds,
    adminChannelIds,
    seniorChannelIds,
    metrics,
    telemetry,
    ytDlpExecutor,
    commandRateLimiter,
    encoder,
    verbose,
    hasStartedPlaying: false,
    get youtubeAuthHealthy() {
      return youtubeAuthState.healthy;
    },
  };
  const maxConcurrentCommands = config.RHAPSOD_MAX_CONCURRENT_COMMANDS;
  let activeCommands = 0;
  let busyFeedbackAt = 0;
  let rateLimitFeedbackAt = 0;
  let mutedFeedbackAt = 0;
  let canTalk = true;
  const handleChatCommand = async (
    message: string,
    senderUid: string,
    senderName: string,
    senderGroups: readonly string[],
    respond: (message: string) => Promise<void>,
  ): Promise<void> => {
    const send = respond;
    try {
      const command = parseChatCommand(message);
      if (!command) return;
      telemetry.recordCommand(senderUid);
      if (!canTalk) {
        if (Date.now() - mutedFeedbackAt > 10_000) {
          mutedFeedbackAt = Date.now();
          await connection
            .sendChannelMessage(
              "El bot no puede hablar en este canal: no voy a procesar comandos hasta que me muevan a un canal donde se escuche.",
            )
            .catch(() => undefined);
        }
        return;
      }
      logger.info({ command: message, senderName, senderUid }, "Chat command");
      const rateGate = commandRateLimiter.acquire(`user:${senderUid}`, 1_500);
      if (!rateGate.allowed) {
        if (Date.now() - rateLimitFeedbackAt > 5_000) {
          rateLimitFeedbackAt = Date.now();
          await send(
            `Esperá un momento entre comandos (${Math.ceil(rateGate.retryAfterMs / 1_000)} s).`,
          );
        }
        return;
      }
      const sender = {
        name: senderName,
        uid: senderUid,
        groups: senderGroups,
      };
      await dispatchCommand(commandContext, command, sender, send);
    } catch (error) {
      logger.warn(
        { command: message, senderName, senderUid, err: error },
        "Command failed",
      );
      const messageText =
        error instanceof Error
          ? userFacingError(error)
          : "Error procesando comando";
      await send(messageText).catch(() => undefined);
    }
  };
  connection.onTextMessage(
    (message, senderUid, senderName, senderGroups, isPrivate, invokerClid) => {
      const privateAllowed = isPrivate && privateCommandUids.has(senderUid);
      const respond = privateAllowed
        ? (text: string) => connection.sendPrivateMessage(invokerClid, text)
        : (text: string) => connection.sendChannelMessage(text);
      if (activeCommands >= maxConcurrentCommands) {
        if (Date.now() - busyFeedbackAt > 5_000) {
          busyFeedbackAt = Date.now();
          void respond(
            "El bot está procesando varios pedidos a la vez; probá de nuevo en unos segundos.",
          ).catch(() => undefined);
        }
        return;
      }
      activeCommands++;
      void handleChatCommand(
        message,
        senderUid,
        senderName,
        senderGroups,
        respond,
      ).finally(() => {
        activeCommands--;
      });
    },
  );
  await connection.connect();
  logger.info("Connected to TeamSpeak 3");
  telemetry.resetClients();
  const seedTelemetry = async (): Promise<void> => {
    try {
      const clients = await connection.listClients();
      for (const c of clients) {
        telemetry.recordPresence(
          c.uid,
          c.name,
          c.groups ?? [],
          c.talkPower,
          c.cid,
        );
      }
    } catch {
      // Seeding is best-effort; clientEnter events fill gaps.
    }
  };
  await seedTelemetry();
  const logCurrentChannel = async (reason: string): Promise<void> => {
    const currentChannel = await connection.getCurrentChannel();
    logger.info(
      {
        reason,
        channelId: currentChannel.cid,
        ...(currentChannel.name === undefined
          ? {}
          : { channelName: currentChannel.name }),
      },
      "Bot current TeamSpeak channel",
    );
  };
  await logCurrentChannel("startup");

  const checkTalkPower = async (reason: string): Promise<void> => {
    const current = await connection.canTalkInCurrentChannel();
    if (current === canTalk) return;
    canTalk = current;
    logger.info({ reason, canTalk }, "Talk power changed");
  };
  await checkTalkPower("startup");
  if (!canTalk) {
    logger.warn(
      "The bot cannot talk in its current channel; commands will be ignored until it is moved",
    );
  }
  connection.onClientEnter((event) => {
    telemetry.clientEntered({
      clid: event.clid,
      uid: event.uid,
      name: event.name,
      groupIds: event.groups,
      channelId: event.cid,
    });
  });
  connection.onClientLeave((clid) => {
    telemetry.clientLeft(clid);
  });
  connection.onClientMoved((event) => {
    if (event.self) {
      void checkTalkPower("moved");
      if (event.invokerUid) {
        telemetry.recordBotMovedBy(event.invokerUid);
        logger.info(
          {
            movedBy: event.invokerName,
            movedByUid: event.invokerUid,
            toChannelId: event.targetCid,
          },
          "Bot moved to another channel",
        );
      }
      return;
    }
    const botChannelId = connection.getCurrentChannelId();
    if (event.targetCid === botChannelId && event.invokerUid) {
      telemetry.recordBotChannelEntry(event.invokerUid);
      logger.info(
        {
          user: event.invokerName,
          userUid: event.invokerUid,
          channelId: event.targetCid,
        },
        "User joined the bot's channel",
      );
    }
  });

  const listConnectedClientUids = async (): Promise<readonly string[]> => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const uids = await connection.listConnectedClientUids();
      if (uids.length > 0) return uids;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
      }
    }
    return [];
  };

  const restoredCount = playback.restoreQueuedTracks(
    await listConnectedClientUids(),
  );
  if (restoredCount > 0) {
    logger.info({ restoredCount }, "Restored queued tracks after restart");
  }

  let reconnecting = false;
  let shuttingDown = false;
  const stopHeartbeat = connection.onConnectionLost((reason) => {
    if (reconnecting || shuttingDown) return;
    reconnecting = true;
    playback.pause();
    void (async () => {
      for (let attempt = 1; attempt <= maxReconnectAttempts; attempt++) {
        const delayMs = Math.min(80, 5 * 2 ** (attempt - 1)) * 1_000;
        logger.warn(
          {
            attempt,
            delaySeconds: delayMs / 1_000,
            maxReconnectAttempts,
            reason,
          },
          "TeamSpeak connection lost; reconnecting",
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        try {
          await connection.connect();
          logger.info({ attempt }, "Reconnected to TeamSpeak 3");
          await logCurrentChannel("reconnect");
          reconnecting = false;
          await checkTalkPower("reconnect");
          playback.resume();
          return;
        } catch (error) {
          logger.error({ attempt, error }, "TeamSpeak reconnect failed");
        }
      }
      logger.error(
        { maxReconnectAttempts },
        "Reconnect limit reached; flushing state and stopping bot",
      );
      shuttingDown = true;
      stopHeartbeat();
      playback.stop(false);
      await connection.disconnect().catch(() => undefined);
      await Promise.all([
        playback.flushState().catch(() => undefined),
        audioUrlCache.flush().catch(() => undefined),
        telemetry.save().catch(() => undefined),
      ]);
      process.exit(1);
    })();
  });

  if (config.RHAPSOD_AUDIO_TEST_TONE_SECONDS > 0) {
    logger.info(
      { durationSeconds: config.RHAPSOD_AUDIO_TEST_TONE_SECONDS },
      "Playing audio test tone",
    );
    await playTestTone(
      config.RHAPSOD_AUDIO_TEST_TONE_SECONDS,
      encoder,
      connection,
    );
  }

  logger.info(
    {
      host: config.RHAPSOD_TS3_HOST,
      nickname: config.RHAPSOD_TS3_NICKNAME,
      port: config.RHAPSOD_TS3_PORT,
      ytDlpPath: config.RHAPSOD_YTDLP_PATH,
      ffmpegPath: config.RHAPSOD_FFMPEG_PATH,
    },
    "Rhapsod is ready",
  );

  const panel = config.RHAPSOD_PANEL_ENABLED
    ? createPanelServer({
        config,
        envFilePath: config.RHAPSOD_ENV_FILE,
        logger,
        status: () => ({
          connected: connection.getCurrentChannelId() > 0,
          ...(connection.getCurrentChannelId() > 0
            ? { currentChannelId: connection.getCurrentChannelId() }
            : {}),
          queueLength: playback.queue().length,
          ...(playback.current === undefined
            ? {}
            : { currentTitle: playback.current.title }),
          version: process.env.npm_package_version ?? "2.2.0",
        }),
        queue: (): QueueEntry[] =>
          playback.queue().map((track) => ({
            title: track.title ?? "Sin titulo",
            source: track.source,
            requestedBy: track.requestedBy,
          })),
        executeCommand: async (raw: string): Promise<string> => {
          const parsed = parseChatCommand(raw);
          if (parsed === undefined) {
            throw new Error("Comando no valido");
          }
          const responses: string[] = [];
          const send = (text: string): Promise<void> => {
            responses.push(text);
            return Promise.resolve();
          };
          const sender = { name: "Panel", uid: "panel", groups: [] };
          await dispatchCommand(commandContext, parsed, sender, send);
          return responses.join("\n") || "OK";
        },
        restart: (): void => {
          logger.info("Panel requested restart");
          process.exit(1);
        },
      })
    : undefined;

  const shutdown = (): void => {
    logger.info("Shutdown initiated; stopping playback and flushing state");
    playback.stop(false);
    encoder.close();
    stopHeartbeat();
    const disconnect = connection.disconnect();
    void Promise.all([
      disconnect.catch(() => undefined),
      playback.flushState().catch(() => undefined),
      audioUrlCache.flush().catch(() => undefined),
      telemetry.save(),
      ...(panel === undefined ? [] : [panel.close().catch(() => undefined)]),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]).then(() => {
      logger.info("Shutdown complete");
      process.exit(0);
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

export function userFacingError(error: Error): string {
  if (error instanceof UserError) return error.message;
  const msg = error.message;
  if (/DRM protected/i.test(msg))
    return "SoundCloud no permite reproducir esta pista porque está protegida con DRM. Probá otra versión o una fuente distinta.";
  if (/Requested format is not available/i.test(msg))
    return "YouTube no ofrece un formato de audio reproducible para ese video (puede ser un directo o un video restringido). Probá otra versión.";
  if (/fetch failed/i.test(msg))
    return "Fallo momentáneo de red con el proveedor (Spotify/YouTube). Probá de nuevo en unos segundos.";
  if (/ya está en la cola/i.test(msg)) return "Esa canción ya está en la cola.";
  return "Ocurrió un error. Probá de nuevo en unos segundos.";
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unknown startup error";
  process.stderr.write(`Rhapsod failed to start: ${message}\n`);
  process.exitCode = 1;
});
