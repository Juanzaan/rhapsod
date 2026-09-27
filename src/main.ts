import "dotenv/config";

import { join } from "node:path";

import { Ts3IdentityStore } from "./adapters/ts3/identity-store.js";
import {
  createTs3Connection,
  DUPLICATE_INSTANCE_EXIT_CODE,
  DuplicateBotInstanceError,
} from "./adapters/ts3/ts3-connection.js";
import { createRhapsodOpusEncoder } from "./audio/opus-encoder.js";
import { createPcmStream, playFfmpegUrl } from "./audio/ffmpeg-player.js";
import { probeFfmpegFilter, resolveFfmpegBinary } from "./audio/ffmpeg-pcm.js";
import { LoudnessProfiler } from "./audio/loudness-profiler.js";
import { playTestTone } from "./audio/test-tone-player.js";
import { YoutubePlaybackService } from "./application/youtube-playback-service.js";
import { PlaylistStore } from "./application/playlist-store.js";
import { AdminClaim } from "./application/admin-claim.js";
import type { CommandContext } from "./commands/command-handlers.js";
import {
  classifyYoutubeAuthFailure,
  type YoutubeAuthFailureCategory,
} from "./lib/youtube-auth-health.js";
import { CommandRateLimiter } from "./commands/command-rate-limiter.js";
import { SkipVotes } from "./application/skip-votes.js";
import { loadConfig } from "./config.js";
import { FilePlaybackStateStore } from "./domain/state-store.js";
import {
  parseAdminUids,
  parseChannelIds,
  parseMoveGroupIds,
} from "./commands/permissions.js";
import { createYtDlpResolverStack } from "./media/youtube/yt-dlp.js";
import { resolveInstanceDir } from "./lib/instance-dir.js";
import { messages } from "./lib/messages.js";
import { loadEnvFile, saveEnvFile } from "./panel/env-file.js";
import { RadioTitleCache } from "./media/radio-icy.js";
import { RadioScrobbler } from "./application/radio-scrobbler.js";
import { ChatLog, isOwnEcho } from "./application/chat-log.js";
import type { YoutubePlaybackResolver } from "./media/youtube/youtube-resolver.js";
import type { DaemonHealthSnapshot } from "./media/youtube/daemon-health.js";
import { RedirectResolver } from "./media/redirect-resolver.js";
import { resolveTuneInUrl } from "./media/tunein.js";
import { SongLinkClient } from "./media/song-link.js";
import { AppleMusicClient } from "./media/apple-music.js";
import { DirectUrlClient } from "./media/direct-url.js";
import { startEgressGuard } from "./lib/egress-guard.js";
import { PlaybackMetrics } from "./observability/prometheus.js";
import { LyricsClient } from "./media/lyrics.js";
import { NonMusicSegments } from "./media/youtube/non-music-segments.js";
import { SoundCloudPublicApi } from "./media/soundcloud/public-api.js";
import { SpotifyApi } from "./media/spotify/api.js";
import {
  createRhapsodLogger,
  flushLoggerSync,
} from "./observability/logger.js";
import { MetricsCollector } from "./observability/metrics.js";
import { startWatchdog, watchdogInterval } from "./watchdog.js";
import {
  ExitCoordinator,
  installCrashHandlers,
  onStopSignal,
} from "./bootstrap/exit.js";
import { startSetupMode } from "./bootstrap/setup-mode.js";
import { ChatCommandGate } from "./bootstrap/chat-commands.js";
import { Reconnector } from "./bootstrap/reconnect.js";
import { startConnectedPanel } from "./bootstrap/panel.js";
import { createPlaybackEvents } from "./bootstrap/playback-events.js";
import { ServerViewSync } from "./bootstrap/server-view.js";
import { NoticeMonitor } from "./bootstrap/notices.js";
import { AdminAlerts } from "./application/notices/admin-alerts.js";
import { flushStores, openStores } from "./bootstrap/stores.js";
import { ytDlpStackOptions } from "./bootstrap/yt-dlp-options.js";

const exits = new ExitCoordinator();

async function main(): Promise<void> {
  const config = loadConfig();
  const dataDir = resolveInstanceDir(
    config.RHAPSOD_DATA_DIR,
    config.RHAPSOD_INSTANCE_ID,
  );
  const logger = await createRhapsodLogger({
    level: config.RHAPSOD_LOG_LEVEL,
    logDir: join(dataDir, "logs"),
    retentionDays: config.RHAPSOD_LOG_RETENTION_DAYS,
  });
  exits.setLogFlush(() => flushLoggerSync(logger));
  const metrics = new MetricsCollector();
  const playbackMetrics = new PlaybackMetrics();
  installCrashHandlers(logger, exits);
  const adminUids = new Set(parseAdminUids(config.RHAPSOD_ADMIN_UIDS));
  const adminClaim = await AdminClaim.open({
    adminUids,
    codePath: join(dataDir, "admin-claim-code"),
    persist: async (uids) => {
      const env = loadEnvFile(config.RHAPSOD_ENV_FILE);
      env.values.RHAPSOD_ADMIN_UIDS = uids.join(",");
      await saveEnvFile(env.path, env.values);
    },
  });
  if (adminClaim.code !== undefined) {
    logger.warn(
      { code: adminClaim.code },
      "No admin configured: send !claim <code> in TeamSpeak to become admin",
    );
  }
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
    startSetupMode({ config, dataDir, exits, logger });
    return;
  }

  // The TeamSpeak connect timeouts run on unref'd timers. When the UDP
  // socket closed on ECONNREFUSED mid-connect, nothing held the event loop
  // and Node exited with code 0, which Restart=on-failure never restarts.
  // The bot now only stops through exits.exit().
  setInterval(() => undefined, 2 ** 31 - 1);
  const daemonHealthRef: {
    get: () => DaemonHealthSnapshot | undefined;
  } = { get: () => undefined };
  const notices = new NoticeMonitor({
    config,
    dataDir,
    logger,
    daemonHealth: () => daemonHealthRef.get(),
  });
  notices.start();
  const identity = await new Ts3IdentityStore(
    join(dataDir, "ts3-identity.txt"),
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
  const watchdog = watchdogInterval(config);
  if (watchdog.ignoredMinutes) {
    logger.warn(
      { intervalSeconds: watchdog.intervalMs / 1_000 },
      "RHAPSOD_WATCHDOG_INTERVAL_MINUTES is deprecated and ignored except 0 (off); set RHAPSOD_WATCHDOG_INTERVAL_SECONDS instead",
    );
  }
  if (watchdog.intervalMs > 0) {
    startWatchdog({
      intervalMs: watchdog.intervalMs,
      onTimeout: (driftMs) => {
        logger.error({ driftMs }, "Watchdog: event loop blocked; restarting");
        notices.eventLoopStall(driftMs);
        void exits.exit(1);
      },
    });
  }
  const connection = createTs3Connection(config, identity, logger);
  const chatLog = new ChatLog();
  let lastOutgoing: { text: string; ts: number } | undefined;
  const rawSendChannelMessage = connection.sendChannelMessage.bind(connection);
  connection.sendChannelMessage = async (text: string): Promise<void> => {
    lastOutgoing = { text, ts: Date.now() };
    chatLog.push(config.RHAPSOD_TS3_NICKNAME, text, true);
    return rawSendChannelMessage(text);
  };
  const stores = openStores({ dataDir, logger, metrics });
  const {
    audioUrlCache,
    listeningHistory,
    preferences,
    songLibrary,
    telemetry,
  } = stores;
  const radioTitles = new RadioTitleCache();
  const serverView = new ServerViewSync(connection, logger);
  setInterval(() => {
    telemetry.logSummary("periodic");
    void telemetry.save();
  }, 15 * 60_000).unref();
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
  const peakLimiter = await probeFfmpegFilter(
    resolveFfmpegBinary(ffmpegPath),
    "alimiter",
  );
  if (!peakLimiter) {
    logger.warn(
      "FFmpeg has no alimiter filter: measured tracks keep loudnorm's linear pass",
    );
  }
  const { proxyUrl: egressProxyUrl } = await startEgressGuard({ logger });
  const loudnessProfiler = new LoudnessProfiler({
    ...(ffmpegPath === undefined ? {} : { binary: ffmpegPath }),
    targetLufs: config.RHAPSOD_LOUDNESS_TARGET_LUFS,
    egressProxyUrl,
  });
  const { executor: ytDlpExecutor, resolver: ytDlpResolver } =
    createYtDlpResolverStack(logger, {
      ...ytDlpStackOptions(config),
      ...(config.RHAPSOD_MAX_CONCURRENT_YTDLP_JOBS === undefined
        ? {}
        : { maxConcurrentJobs: config.RHAPSOD_MAX_CONCURRENT_YTDLP_JOBS }),
      onSearchMetrics: (m) => metrics.recordSearchMetrics(m),
    });
  ytDlpMetricsRef.getMetrics = () => ytDlpExecutor.metrics();
  daemonHealthRef.get = () => ytDlpResolver.daemonHealth();
  const resolver: YoutubePlaybackResolver = ytDlpResolver;
  const playback = new YoutubePlaybackService({
    createPlayback: (url, playbackEncoder, output, options) =>
      playFfmpegUrl(url, playbackEncoder, output, {
        ...(ffmpegPath === undefined ? {} : { binary: ffmpegPath }),
        egressProxyUrl,
        peakLimiter,
        // The controller decides per track: finite tracks carry a target,
        // live radio omits it so endless streams skip dynamic loudnorm.
        ...(options?.loudnessTargetLufs === undefined
          ? {}
          : { loudnessTargetLufs: options.loudnessTargetLufs }),
        ...(ffmpegUserAgent === undefined
          ? {}
          : { userAgent: ffmpegUserAgent }),
        ...(config.RHAPSOD_WARP_PROXY === undefined
          ? {}
          : { proxyUrl: config.RHAPSOD_WARP_PROXY }),
        ...(options?.seekSeconds === undefined
          ? {}
          : { seekSeconds: options.seekSeconds }),
        ...(options?.live === undefined ? {} : { live: options.live }),
        ...(options?.loudnessProfile === undefined
          ? {}
          : { loudnessProfile: options.loudnessProfile }),
        ...(options?.stream === undefined ? {} : { stream: options.stream }),
      }),
    ...(config.RHAPSOD_WARP_PROXY === undefined
      ? {}
      : { proxyUrl: config.RHAPSOD_WARP_PROXY }),
    // Prewarmed next-track streams need the same binary and User-Agent as
    // cold starts; the default factory used to fall back to ffmpeg-static.
    createPcmStream: (url, options) =>
      createPcmStream(url, {
        ...options,
        ...(ffmpegPath === undefined ? {} : { binary: ffmpegPath }),
        egressProxyUrl,
        peakLimiter,
        ...(ffmpegUserAgent === undefined
          ? {}
          : { userAgent: ffmpegUserAgent }),
      }),
    prewarmNext: true,
    loudnessProfiler,
    ...(config.RHAPSOD_SKIP_NON_MUSIC
      ? { nonMusicSegments: new NonMusicSegments({ logger }) }
      : {}),
    encoder,
    ...createPlaybackEvents({
      listeningHistory,
      logger,
      markStarted: () => {
        const first = !commandContext.hasStartedPlaying;
        commandContext.hasStartedPlaying = true;
        return first;
      },
      metrics,
      playbackMetrics,
      sendChannelMessage: (text) => connection.sendChannelMessage(text),
      songLibrary,
    }),
    output: connection,
    resolver,
    stateStore: new FilePlaybackStateStore(join(dataDir, "state.json"), logger),
    audioUrlCache,
    redirectResolver: new RedirectResolver(),
    tuneInStreamUrl: (url) => resolveTuneInUrl(url),
    playlistStore: new PlaylistStore(join(dataDir, "playlists.json"), logger),
    autoplayProfile: listeningHistory,
    maxQueueTracks: config.RHAPSOD_MAX_QUEUE_TRACKS,
    maxTracksPerUser: config.RHAPSOD_MAX_TRACKS_PER_USER,
    alternativeResolver: new SongLinkClient({ logger }),
    appleMusicResolver: new AppleMusicClient(),
    directUrlResolver: new DirectUrlClient({
      egressProxyUrl,
      ...(config.RHAPSOD_FFPROBE_PATH === undefined
        ? {}
        : { ffprobeBinary: config.RHAPSOD_FFPROBE_PATH }),
    }),
    soundcloudResolver: new SoundCloudPublicApi({
      logger,
      clientIdCachePath: join(dataDir, "soundcloud-client-id.json"),
    }),
    lyricsResolver: new LyricsClient({ logger }),
    ...(spotifyResolver ? { spotifyResolver } : {}),
  });
  const flushState = (): Promise<void> =>
    flushStores(
      stores,
      () => playback.flushState(),
      () => notices.flush(),
    );
  exits.setFlush(flushState);
  const youtubeAuthCheckUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  const youtubeAuthCheckIntervalMs = 24 * 60 * 60 * 1_000;
  const youtubeAuthRetryIntervalMs = 15 * 60 * 1_000;
  const youtubeAuthState: {
    healthy: boolean;
    category?: YoutubeAuthFailureCategory;
  } = { healthy: true };
  const checkYoutubeAuth = async (): Promise<void> => {
    try {
      await ytDlpExecutor.run(
        ["--get-url", "--no-playlist", "--no-warnings", youtubeAuthCheckUrl],
        25_000,
        "metadata",
      );
      notices.youtubeCheckPassed();
      if (!youtubeAuthState.healthy) {
        logger.info("YouTube authentication recovered");
        youtubeAuthState.healthy = true;
        delete youtubeAuthState.category;
      }
    } catch (error) {
      const category = classifyYoutubeAuthFailure(error);
      youtubeAuthState.category = category;
      notices.youtubeCheckFailed(category);
      if (youtubeAuthState.healthy) {
        logger.error(
          { err: error, category },
          "YouTube authentication health check FAILED",
        );
      }
      youtubeAuthState.healthy = false;
    }
  };
  // Daily while healthy; every 15 minutes while failing, so a fix (new
  // cookies, a yt-dlp update) clears the notice without waiting a day.
  const scheduleYoutubeAuthCheck = (): void => {
    setTimeout(
      () => void checkYoutubeAuth().finally(scheduleYoutubeAuthCheck),
      youtubeAuthState.healthy
        ? youtubeAuthCheckIntervalMs
        : youtubeAuthRetryIntervalMs,
    ).unref();
  };
  void checkYoutubeAuth().finally(scheduleYoutubeAuthCheck);
  const commandRateLimiter = new CommandRateLimiter();
  const commandContext: CommandContext = {
    playback,
    connection,
    config,
    adminUids,
    ...(adminClaim.code === undefined ? {} : { adminClaim }),
    moveGroupIds,
    adminGroupIds,
    seniorGroupIds,
    adminChannelIds,
    seniorChannelIds,
    metrics,
    telemetry,
    preferences,
    radioTitles,
    listeningHistory,
    ytDlpExecutor,
    commandRateLimiter,
    skipVotes: new SkipVotes(),
    encoder,
    verbose,
    hasStartedPlaying: false,
    get youtubeAuthHealthy() {
      return youtubeAuthState.healthy;
    },
    get youtubeAuthFailure() {
      return youtubeAuthState.category;
    },
    notices: notices.registry,
  };
  let canTalk = true;
  const commandGate = new ChatCommandGate({
    canTalk: () => canTalk,
    context: commandContext,
    logger,
    maxConcurrent: config.RHAPSOD_MAX_CONCURRENT_COMMANDS,
    privateCommandUids,
  });
  connection.onTextMessage(
    (message, senderUid, senderName, senderGroups, isPrivate, invokerClid) => {
      if (
        !isPrivate &&
        !isOwnEcho(
          senderName,
          config.RHAPSOD_TS3_NICKNAME,
          message,
          lastOutgoing,
          Date.now(),
        )
      ) {
        chatLog.push(senderName, message, false);
      }
      void commandGate.receive({
        invokerClid,
        isPrivate,
        message,
        senderGroups,
        senderName,
        senderUid,
      });
    },
  );
  await connection.connect();
  logger.info("Connected to TeamSpeak 3");
  const adminAlerts = new AdminAlerts({
    registry: notices.registry,
    adminUids: () => adminUids,
    listClients: () => connection.listClients(),
    sendPrivateMessage: (clid, text) =>
      connection.sendPrivateMessage(clid, text),
    logger,
  });
  adminAlerts.start();
  if (adminClaim.code !== undefined) {
    void connection
      .sendChannelMessage(messages.claimAvisoCanal)
      .catch(() => undefined);
  }
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
  await serverView.resync();
  // The minute view stays cheap; the full scan refreshes in the background.
  void serverView.resync({ full: true });
  setInterval(() => void serverView.tick(), 60_000).unref();
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
    notices.talkPower(canTalk, connection.getCurrentChannelId());
    logger.info({ reason, canTalk }, "Talk power changed");
  };
  await checkTalkPower("startup");
  if (!canTalk) {
    logger.warn(
      "The bot cannot talk in its current channel; only !channel-move is accepted until it is moved",
    );
  }
  connection.onClientEnter((event) => {
    adminAlerts.adminEntered(event.uid);
    telemetry.clientEntered({
      clid: event.clid,
      uid: event.uid,
      name: event.name,
      groupIds: event.groups,
      channelId: event.cid,
    });
    serverView.snapshot.applyEnter({
      clid: event.clid,
      name: event.name,
      cid: event.cid,
    });
    void serverView.ensureChannel(event.cid).catch(() => undefined);
  });
  connection.onClientLeave((clid) => {
    telemetry.clientLeft(clid);
    serverView.snapshot.applyLeave(clid);
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
    serverView.snapshot.applyMove(event.movedClid, event.targetCid);
    void serverView.ensureChannel(event.targetCid).catch(() => undefined);
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

  let shuttingDown = false;
  const reconnector = new Reconnector({
    connection,
    isShuttingDown: () => shuttingDown,
    logger,
    onDisconnect: (reason) => {
      metrics.recordDisconnect(reason);
      playback.pause();
    },
    onAttempt: (attempt, maxAttempts) => {
      notices.reconnectAttempt(attempt, maxAttempts);
    },
    onGiveUp: async () => {
      notices.reconnectGaveUp();
      shuttingDown = true;
      stopHeartbeat();
      playback.stop(false);
      await connection.disconnect().catch(() => undefined);
      await exits.exit(1);
    },
    onReconnected: async () => {
      await serverView.resync();
      void serverView.resync({ full: true });
      await logCurrentChannel("reconnect");
    },
    onResumed: async () => {
      notices.reconnected();
      await checkTalkPower("reconnect");
      playback.resume();
    },
  });
  const stopHeartbeat = connection.onConnectionLost((reason) => {
    void reconnector.connectionLost(reason);
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

  // Songs heard on live radio are scrobbled into the same listening history
  // that feeds !tops and autoplay: the station's rotation becomes taste
  // signal instead of evaporating when the stream moves on.
  const scrobbler = new RadioScrobbler(listeningHistory, resolver, songLibrary);
  setInterval(() => {
    const live = playback.current;
    if (live !== undefined && live.durationSeconds === undefined) {
      void radioTitles.get(live.source).catch(() => undefined);
      void scrobbler
        .poll({
          source: live.source,
          title: radioTitles.peek(live.source),
          uid: live.requestedByUid ?? live.requestedBy,
        })
        .catch(() => undefined);
    }
  }, 30_000).unref();

  const panel = startConnectedPanel({
    chatLog,
    commandContext,
    config,
    connection,
    dataDir,
    logger,
    metrics,
    playback,
    playbackMetrics,
    radioTitles,
    resolver: ytDlpResolver,
    reconnecting: () => reconnector.reconnecting,
    restart: () => shutdown(1),
    scrobbler,
    serverView,
    youtubeAuthHealthy: () => youtubeAuthState.healthy,
    ytdlpDaemon: () => ytDlpResolver.daemonHealth(),
  });

  let shutdownStarted = false;
  const shutdown = (code: number): void => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    logger.info("Shutdown initiated; stopping playback and flushing state");
    shuttingDown = true;
    playback.stop(false);
    encoder.close();
    stopHeartbeat();
    exits.setFlush(async () => {
      await Promise.all([
        connection.disconnect().catch(() => undefined),
        flushState(),
        ...(panel === undefined ? [] : [panel.close().catch(() => undefined)]),
      ]);
      logger.info("Shutdown complete");
    });
    void exits.exit(code);
  };
  onStopSignal(() => shutdown(0));
}

void main().catch((error: unknown) => {
  if (error instanceof DuplicateBotInstanceError) {
    process.stderr.write(`Rhapsod refused to start: ${error.message}\n`);
    void exits.exit(DUPLICATE_INSTANCE_EXIT_CODE);
    return;
  }
  const message =
    error instanceof Error ? error.message : "Unknown startup error";
  process.stderr.write(`Rhapsod failed to start: ${message}\n`);
  void exits.exit(1);
});
