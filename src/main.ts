import "dotenv/config";

import { join } from "node:path";

import { Ts3IdentityStore } from "./adapters/ts3/identity-store.js";
import {
  createTs3Connection,
  DUPLICATE_INSTANCE_EXIT_CODE,
  DuplicateBotInstanceError,
  withTimeout,
} from "./adapters/ts3/ts3-connection.js";
import { createRhapsodOpusEncoder } from "./audio/opus-encoder.js";
import { createPcmStream, playFfmpegUrl } from "./audio/ffmpeg-player.js";
import { LoudnessProfiler } from "./audio/loudness-profiler.js";
import { playTestTone } from "./audio/test-tone-player.js";
import { YoutubePlaybackService } from "./application/youtube-playback-service.js";
import { PlaylistStore } from "./application/playlist-store.js";
import { AUTOPLAY_UID } from "./application/autoplay-picker.js";
import {
  normalizeCommandInput,
  parseChatCommand,
  runsWithoutTalkPower,
} from "./commands/chat-command.js";
import { probeTs3Server } from "./adapters/ts3/probe.js";
import {
  dispatchCommand,
  type CommandContext,
} from "./commands/command-handlers.js";
import { formatPlaybackError, formatPlaybackStarted } from "./lib/messages.js";
import { classifyYoutubeAuthFailure } from "./lib/youtube-auth-health.js";
import { CommandRateLimiter } from "./commands/command-rate-limiter.js";
import { SkipVotes } from "./application/skip-votes.js";
import { loadConfig } from "./config.js";
import type { Track } from "./domain/track.js";
import { FilePlaybackStateStore } from "./domain/state-store.js";
import {
  parseAdminUids,
  parseChannelIds,
  parseMoveGroupIds,
} from "./commands/permissions.js";
import { createYtDlpResolverStack } from "./media/youtube/yt-dlp.js";
import { resolveInstanceDir } from "./lib/instance-dir.js";
import { RadioTitleCache } from "./media/radio-icy.js";
import { RadioScrobbler } from "./application/radio-scrobbler.js";
import { createPanelServer, type QueueEntry } from "./panel/panel-server.js";
import { ChatLog, isOwnEcho } from "./application/chat-log.js";
import {
  createCookieSaver,
  createYoutubeHealthCheck,
} from "./panel/youtube-setup.js";
import type { YoutubePlaybackResolver } from "./media/youtube/youtube-resolver.js";
import { RedirectResolver } from "./media/redirect-resolver.js";
import { resolveTuneInUrl } from "./media/tunein.js";
import { SongLinkClient } from "./media/song-link.js";
import { AppleMusicClient } from "./media/apple-music.js";
import { DirectUrlClient } from "./media/direct-url.js";
import { APP_VERSION as packageVersion } from "./lib/version.js";
import { startEgressGuard } from "./lib/egress-guard.js";
import {
  PlaybackMetrics,
  renderPrometheus,
} from "./observability/prometheus.js";
import { LyricsClient, parseArtistTitle } from "./media/lyrics.js";
import { SoundCloudPublicApi } from "./media/soundcloud/public-api.js";
import { SpotifyApi } from "./media/spotify/api.js";
import { createRhapsodLogger } from "./observability/logger.js";
import { MetricsCollector } from "./observability/metrics.js";
import { startWatchdog, watchdogInterval } from "./watchdog.js";
import {
  ExitCoordinator,
  installCrashHandlers,
  onStopSignal,
} from "./bootstrap/exit.js";
import { startSetupMode } from "./bootstrap/setup-mode.js";
import { ServerViewSync } from "./bootstrap/server-view.js";
import { flushStores, openStores } from "./bootstrap/stores.js";
import { ytDlpStackOptions } from "./bootstrap/yt-dlp-options.js";
import { userFacingError } from "./lib/user-facing-error.js";

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
  const metrics = new MetricsCollector();
  const playbackMetrics = new PlaybackMetrics();
  const trackTimings = new Map<
    string,
    { audioUrlMs?: number; cacheHit?: boolean; metadataMs?: number }
  >();
  const setTrackTiming = (
    trackId: string,
    timing: { audioUrlMs?: number; cacheHit?: boolean; metadataMs?: number },
  ): void => {
    // Metadata and audio-URL timings arrive separately for the same track;
    // merge so the second report does not erase the first.
    trackTimings.set(trackId, { ...trackTimings.get(trackId), ...timing });
    if (trackTimings.size > 200) {
      const oldest = trackTimings.keys().next().value;
      if (oldest !== undefined) trackTimings.delete(oldest);
    }
  };
  installCrashHandlers(logger, exits);
  const adminUids = parseAdminUids(config.RHAPSOD_ADMIN_UIDS);
  const panelAdminUids: ReadonlySet<string> = new Set([...adminUids, "panel"]);
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
  const maxReconnectAttempts = 5;
  // Reconnect attempts must fail fast: a stuck handshake would otherwise eat
  // the whole startup-style timeout (minutes) before the next attempt runs.
  const reconnectConnectTimeoutMs = 30_000;
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
  const resolver: YoutubePlaybackResolver = ytDlpResolver;
  const playback = new YoutubePlaybackService({
    createPlayback: (url, playbackEncoder, output, options) =>
      playFfmpegUrl(url, playbackEncoder, output, {
        ...(ffmpegPath === undefined ? {} : { binary: ffmpegPath }),
        egressProxyUrl,
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
        ...(ffmpegUserAgent === undefined
          ? {}
          : { userAgent: ffmpegUserAgent }),
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
      listeningHistory.recordStart(track.requestedByUid ?? track.requestedBy, {
        id: track.id,
        title: track.title,
      });
      // Endless radio streams are not songs themselves; their songs enter
      // the library through the scrobbler once the station names them.
      if (track.durationSeconds !== undefined) {
        const { artist } = parseArtistTitle(track.title);
        songLibrary.record({
          ...(artist === undefined ? {} : { artist }),
          id: track.id,
          source: track.source,
          title: track.title,
        });
      }
      const isFirst = !commandContext.hasStartedPlaying;
      commandContext.hasStartedPlaying = true;
      await connection.sendChannelMessage(
        track.requestedByUid === AUTOPLAY_UID
          ? `Autoplay: ${track.title}`
          : formatPlaybackStarted(track.title, isFirst),
      );
    },
    onPlaybackFinished: (track, metrics, reason, kpis) => {
      playbackMetrics.record(reason, metrics, kpis);
      const timings = trackTimings.get(track.id);
      trackTimings.delete(track.id);
      logger.info(
        {
          ...timings,
          ...metrics,
          ...kpis,
          reason,
          trackId: track.id,
          title: track.title,
        },
        "Playback session",
      );
      listeningHistory.recordFinish(
        track.requestedByUid ?? track.requestedBy,
        { id: track.id, title: track.title },
        reason === "completed",
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
      metrics.recordError(track.id, error, track.title);
      logger.error(
        { err: error, trackId: track.id },
        "YouTube playback failed",
      );
      await connection.sendChannelMessage(formatPlaybackError(track.title));
    },
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
    flushStores(stores, () => playback.flushState());
  exits.setFlush(flushState);
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
      if (!canTalk && !runsWithoutTalkPower(command)) {
        if (Date.now() - mutedFeedbackAt > 10_000) {
          mutedFeedbackAt = Date.now();
          await connection
            .sendChannelMessage(
              "El bot no puede hablar en este canal: solo acepto !channel-move <canal> hasta que me muevan a un canal donde se escuche.",
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
    logger.info({ reason, canTalk }, "Talk power changed");
  };
  await checkTalkPower("startup");
  if (!canTalk) {
    logger.warn(
      "The bot cannot talk in its current channel; only !channel-move is accepted until it is moved",
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

  let reconnecting = false;
  let shuttingDown = false;
  const stopHeartbeat = connection.onConnectionLost((reason) => {
    if (reconnecting || shuttingDown) return;
    reconnecting = true;
    metrics.recordDisconnect(reason);
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
          await withTimeout(
            // Skip the duplicate check here: our own ghost can still be
            // listed right after a dropped connection, and refusing there
            // would keep a live bot down on every network blip.
            connection.connect({ skipDuplicateCheck: true }),
            reconnectConnectTimeoutMs,
            "Reconnect attempt timed out",
          );
          logger.info({ attempt }, "Reconnected to TeamSpeak 3");
          await serverView.resync();
          void serverView.resync({ full: true });
          await logCurrentChannel("reconnect");
          reconnecting = false;
          await checkTalkPower("reconnect");
          playback.resume();
          return;
        } catch (error) {
          logger.error({ attempt, err: error }, "TeamSpeak reconnect failed");
          // A timed-out attempt may leave a half-open client behind;
          // make sure the next attempt starts from a clean state.
          await connection.disconnect().catch(() => undefined);
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
      await exits.exit(1);
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

  const currentDisplayTitle = (current: Track): string => {
    if (current.durationSeconds !== undefined) return current.title;
    return radioTitles.peek(current.source) ?? current.title;
  };
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
            : { currentTitle: currentDisplayTitle(playback.current) }),
          ...(playback.current?.durationSeconds === undefined
            ? {}
            : { durationMs: playback.current.durationSeconds * 1000 }),
          positionMs: playback.playbackPositionMs,
          playerState: playback.playerState,
          volume: playback.volume,
          loopMode: playback.loopMode,
          tracksPlayed: playback.tracksPlayed + scrobbler.confirmedCount,
          uptimeMs: Math.round(process.uptime() * 1000),
          disconnects: metrics.disconnectSummary(),
          version: packageVersion,
        }),
        queue: (): QueueEntry[] =>
          playback.queue().map((track) => ({
            title: track.title ?? "Sin titulo",
            source: track.source,
            requestedBy: track.requestedBy,
          })),
        errors: () => metrics.errorSummary(20),
        metricsText: () =>
          renderPrometheus({
            counters: metrics.counters(),
            memoryRssBytes: process.memoryUsage.rss(),
            playback: playbackMetrics,
            uptimeSeconds: process.uptime(),
            version: packageVersion,
          }),
        chat: () => chatLog.snapshot(),
        sendChat: (text: string) => connection.sendChannelMessage(text),
        serverView: () => ({
          ...serverView.toJSON(),
          botChannelId: connection.getCurrentChannelId(),
          mode: serverView.mode,
        }),
        moveBot: (cid: number) => connection.moveToChannel(cid),
        youtubeHealth: createYoutubeHealthCheck((url, signal) =>
          ytDlpResolver.getAudioUrlFromUrl(url, signal),
        ),
        saveCookies: createCookieSaver(
          config.RHAPSOD_YTDLP_COOKIES_PATH ??
            join(dataDir, "youtube-cookies.txt"),
        ),
        executeCommand: async (raw: string): Promise<string> => {
          const parsed = parseChatCommand(normalizeCommandInput(raw));
          if (parsed === undefined) {
            throw new Error("Comando no valido");
          }
          const responses: string[] = [];
          const send = (text: string): Promise<void> => {
            responses.push(text);
            return Promise.resolve();
          };
          // The panel is the owner console behind basic auth, so it acts
          // as an admin: skip/remove on someone else's track must work
          // from there too. "panel" can never collide with a TS3 uid.
          const sender = { name: "Panel", uid: "panel", groups: [] };
          await dispatchCommand(
            { ...commandContext, adminUids: panelAdminUids },
            parsed,
            sender,
            send,
          );
          return responses.join("\n") || "OK";
        },
        // Exit code 1 so systemd (Restart=on-failure) brings the bot back.
        restart: (): void => {
          logger.info("Panel requested restart");
          shutdown(1);
        },
        testConnection: (host: string, port: number) =>
          probeTs3Server(host, port),
      })
    : undefined;

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
