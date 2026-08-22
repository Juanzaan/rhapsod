import "dotenv/config";

import { join } from "node:path";

import { Ts3IdentityStore } from "./adapters/ts3/identity-store.js";
import { createTs3Connection } from "./adapters/ts3/ts3-connection.js";
import { createRhapsodOpusEncoder } from "./audio/opus-encoder.js";
import { playFfmpegUrl } from "./audio/ffmpeg-player.js";
import { playTestTone } from "./audio/test-tone-player.js";
import { YoutubePlaybackService } from "./application/youtube-playback-service.js";
import { AudioUrlCache } from "./application/audio-url-cache.js";
import { UserTelemetry } from "./application/user-telemetry.js";
import { parseChatCommand } from "./commands/chat-command.js";
import { CommandRateLimiter } from "./commands/command-rate-limiter.js";
import { loadConfig } from "./config.js";
import { FilePlaybackStateStore } from "./domain/state-store.js";
import {
  canMoveBotToChannel,
  canRemoveTrack,
  isAdminUid,
  parseAdminUids,
  parseChannelIds,
  parseMoveGroupIds,
} from "./commands/permissions.js";
import {
  SystemYtDlpExecutor,
  YoutubeResolver,
} from "./media/youtube/yt-dlp.js";
import { createYoutubeiClient } from "./media/youtube/youtubei-client.js";
import { YoutubeiResolver } from "./media/youtube/youtubei-resolver.js";
import { YoutubeResolverWithFallback } from "./media/youtube/youtube-resolver-with-fallback.js";
import { SongLinkClient } from "./media/song-link.js";
import { DirectUrlClient } from "./media/direct-url.js";
import { LyricsClient } from "./media/lyrics.js";
import { SoundCloudPublicApi } from "./media/soundcloud/public-api.js";
import { SpotifyApi } from "./media/spotify/api.js";
import { parseMediaInput } from "./media/media-input.js";
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
    logger.error({ reason }, "Unhandled promise rejection");
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
  const ytDlpExecutor = new SystemYtDlpExecutor(
    config.RHAPSOD_YTDLP_PATH,
    config.RHAPSOD_YTDLP_COOKIES_PATH,
    {
      ...(config.RHAPSOD_MAX_CONCURRENT_YTDLP_JOBS === undefined
        ? {}
        : { maxConcurrentJobs: config.RHAPSOD_MAX_CONCURRENT_YTDLP_JOBS }),
    },
    logger,
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
  const ytDlpResolver = new YoutubeResolver(ytDlpExecutor, logger);
  let youtubeiResolver: YoutubeiResolver | undefined;
  if (config.RHAPSOD_YOUTUBEI_ENABLED) {
    try {
      const youtubeiHandle = await createYoutubeiClient({
        cacheDirectory: join(config.RHAPSOD_DATA_DIR, "youtubei-cache"),
        ...(config.RHAPSOD_YOUTUBEI_POT_URL === undefined
          ? {}
          : { potProviderUrl: config.RHAPSOD_YOUTUBEI_POT_URL }),
        ...(config.RHAPSOD_YOUTUBEI_COOKIE === undefined
          ? {}
          : { cookie: config.RHAPSOD_YOUTUBEI_COOKIE }),
      });
      youtubeiResolver = new YoutubeiResolver(
        youtubeiHandle.client,
        youtubeiHandle.poTokens,
      );
      logger.info("youtubei.js primary resolver enabled");
    } catch (error) {
      logger.warn(
        { err: error },
        "youtubei.js failed to initialize; using yt-dlp only",
      );
    }
  }
  const resolver = new YoutubeResolverWithFallback(
    youtubeiResolver,
    ytDlpResolver,
    logger,
  );
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
      }),
    encoder,
    onPlaybackStarted: async (track) => {
      const timings = trackTimings.get(track.id);
      logger.info(
        { ...timings, trackId: track.id, title: track.title },
        "Playback started",
      );
      await connection.sendChannelMessage(`Reproduciendo: ${track.title}`);
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
      metrics.recordTiming(timing);
      logger.info(timing, "Playback timing");
    },
    onPlaybackError: async (track, error) => {
      metrics.recordError(track.id, error);
      logger.error(
        { err: error, trackId: track.id },
        "YouTube playback failed",
      );
      const truncatedTitle =
        track.title.length > 40 ? `${track.title.slice(0, 39)}…` : track.title;
      await connection.sendChannelMessage(
        `No pude reproducir "${truncatedTitle}". Se intentará continuar con la siguiente canción.`,
      );
    },
    output: connection,
    resolver,
    stateStore: new FilePlaybackStateStore(
      join(config.RHAPSOD_DATA_DIR, "state.json"),
      logger,
    ),
    audioUrlCache,
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
  let youtubeAuthHealthy = true;
  const checkYoutubeAuth = async (): Promise<void> => {
    try {
      await ytDlpExecutor.run(
        ["--get-url", "--no-playlist", "--no-warnings", youtubeAuthCheckUrl],
        25_000,
        "metadata",
      );
      if (!youtubeAuthHealthy) {
        logger.info("YouTube authentication recovered");
        youtubeAuthHealthy = true;
      }
    } catch (error) {
      if (youtubeAuthHealthy) {
        logger.error(
          { err: error },
          "YouTube authentication health check FAILED: the cookies may be expired; re-export them to youtube-cookies.txt",
        );
      }
      youtubeAuthHealthy = false;
    }
  };
  setInterval(
    () => void checkYoutubeAuth(),
    youtubeAuthCheckIntervalMs,
  ).unref();
  void checkYoutubeAuth();
  const commandRateLimiter = new CommandRateLimiter();
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
      switch (command.name) {
        case "play": {
          await send("Preparando la reproducción...");
          const media = parseMediaInput(command.input);
          if (media.kind === "youtube" && media.resource.type === "playlist") {
            const result = await playback.enqueuePlaylist(
              media.resource,
              senderName,
              senderUid,
            );
            const message =
              result.added.length === 0
                ? "La playlist no tiene canciones reproducibles."
                : `Se agregaron ${result.added.length} canciones a la cola${result.remaining ? ` (quedan ${result.remaining} fuera del límite)` : ""}.`;
            await send(message);
          } else if (
            media.kind === "spotify" &&
            media.resource.type !== "track"
          ) {
            const result = await playback.enqueueSpotifyCollection(
              media.resource,
              senderName,
              senderUid,
            );
            const message =
              result.added.length === 0
                ? "La playlist o álbum no tiene canciones reproducibles."
                : `Se agregaron ${result.added.length} canciones a la cola${result.remaining ? ` (quedan ${result.remaining} fuera del límite)` : ""}.`;
            await send(message);
          } else if (
            media.kind === "apple-music" ||
            media.kind === "amazon-music"
          ) {
            const result = await playback.enqueueMusicLink(
              media.value,
              senderName,
              senderUid,
            );
            const message =
              result.added.length === 0
                ? "No pude encontrar ese link en YouTube o SoundCloud."
                : `Se agregaron ${result.added.length} canciones a la cola${result.remaining ? ` (quedan ${result.remaining} fuera del límite)` : ""}.`;
            await send(message);
          } else {
            const track = await playback.enqueue(
              command.input,
              senderName,
              senderUid,
            );
            const viaSearch = media.kind === "file";
            await send(
              `En cola: ${track.title}${viaSearch ? " (búsqueda)" : ""}`,
            );
          }
          break;
        }
        case "playnext": {
          await send("Preparando la próxima pista...");
          const track = await playback.enqueueNext(
            command.input,
            senderName,
            senderUid,
          );
          await send(`Próxima en cola: ${track.title}`);
          break;
        }
        case "search": {
          if (command.index) {
            const track = await playback.enqueueSearchIndex(
              command.input,
              command.index,
              senderName,
              senderUid,
            );
            await send(`En cola (resultado ${command.index}): ${track.title}`);
            break;
          }
          await send("Buscando en YouTube...");
          const track = await playback.enqueueSearch(
            command.input,
            senderName,
            senderUid,
          );
          await send(`En cola: ${track.title}`);
          break;
        }
        case "pause":
          playback.pause();
          await send("Reproducción pausada.");
          break;
        case "previous": {
          const track = playback.replayPrevious();
          await send(`Reproduciendo de nuevo: ${track.title}`);
          break;
        }
        case "resume":
          playback.resume();
          await send("Reproducción reanudada.");
          break;
        case "seek":
          playback.seek(command.seconds);
          await send(`Reproduciendo desde el segundo ${command.seconds}…`);
          break;
        case "queue": {
          const tracks = playback.queue();
          const pageSize = 10;
          const pages = Math.max(1, Math.ceil(tracks.length / pageSize));
          const page = command.page ?? 1;
          await send(
            tracks.length === 0
              ? "La cola está vacía."
              : page > pages
                ? `La cola tiene ${pages} página(s). Usá !queue ${pages}.`
                : [
                    `Cola de reproducción (página ${page}/${pages}):`,
                    ...tracks
                      .slice((page - 1) * pageSize, page * pageSize)
                      .map(
                        (track, index) =>
                          `${(page - 1) * pageSize + index + 1}. ${track.title} (${formatDuration(track.durationSeconds)} - por ${track.requestedBy})`,
                      ),
                  ].join("\n"),
          );
          break;
        }
        case "history": {
          const history = playback.history().slice(0, 10);
          await send(
            history.length === 0
              ? "Todavía no se reprodujo ninguna pista."
              : [
                  "Historial reciente:",
                  ...history.map(
                    (track, index) =>
                      `${index + 1}. ${track.title} (por ${track.requestedBy})`,
                  ),
                ].join("\n"),
          );
          break;
        }
        case "move": {
          const moved = playback.moveQueued(command.from, command.to);
          await send(
            moved
              ? `Movida a la posición ${command.to}: ${moved.title}`
              : command.from === command.to
                ? "La pista ya está en esa posición."
                : "No existe alguna de esas posiciones en la cola.",
          );
          break;
        }
        case "remove": {
          const selected = playback.queue().slice(command.from - 1, command.to);
          const unauthorized = selected.some(
            (track) =>
              !canRemoveTrack({
                adminUids,
                requesterName: track.requestedBy,
                ...(track.requestedByUid === undefined
                  ? {}
                  : { requesterUid: track.requestedByUid }),
                senderName,
                senderUid,
              }),
          );
          if (unauthorized) {
            await send(
              "Solo el administrador del bot puede quitar rangos con pistas de otros usuarios.",
            );
            break;
          }
          const removed = playback.removeQueuedRange(command.from, command.to);
          await send(
            removed.length === 0
              ? "No existe esa posición en la cola."
              : removed.length === 1
                ? `Quitada de la cola: ${removed[0]?.title}`
                : `Se quitaron ${removed.length} pistas de la cola.`,
          );
          break;
        }
        case "clear":
          {
            const cleared = playback.clearQueued();
            await send(
              cleared === 0
                ? "La cola ya estaba vacía."
                : `Se quitaron ${cleared} pistas de la cola.`,
            );
          }
          break;
        case "channel-move": {
          const numericCid = /^\d+$/.test(command.input)
            ? Number(command.input)
            : undefined;
          let target:
            { readonly cid: number; readonly name: string } | undefined;
          if (numericCid !== undefined) {
            target = { cid: numericCid, name: String(numericCid) };
          } else {
            const channels = await connection.listChannels();
            const query = command.input.toLowerCase();
            const matches = channels.filter((ch) =>
              ch.name.toLowerCase().includes(query),
            );
            if (matches.length === 0) {
              await send(`No encontré ningún canal con "${command.input}".`);
              break;
            }
            if (matches.length > 1) {
              const list = matches
                .slice(0, 5)
                .map((ch) => ch.name)
                .join(", ");
              await send(
                `Encontré varios canales: ${list}. Sé más específico.`,
              );
              break;
            }
            target = matches[0]!;
          }
          const decision = canMoveBotToChannel({
            senderUid,
            senderGroups,
            adminUids,
            moveGroupIds,
            adminGroupIds,
            seniorGroupIds,
            adminChannelIds,
            seniorChannelIds,
            targetCid: target.cid,
          });
          if (decision === "deny-rank") {
            await send("No tenés permisos para mover el bot de canal.");
            break;
          }
          if (decision === "deny-admin") {
            await send("Ese canal requiere rango Admin o superior.");
            break;
          }
          if (decision === "deny-senior") {
            await send("Ese canal requiere rango Senior Admin o superior.");
            break;
          }
          try {
            await connection.moveToChannel(target.cid);
            telemetry.recordBotMovedBy(senderUid);
            const resolvedName =
              numericCid !== undefined
                ? (await connection.getChannelInfo(numericCid)).channel_name
                : undefined;
            await send(`Movido al canal: ${resolvedName ?? target.name}`);
          } catch {
            await send("No pude moverme a ese canal (¿permisos?).");
          }
          break;
        }
        case "shuffle":
          {
            const shuffled = playback.shuffleQueued();
            await send(
              shuffled === 0
                ? "No hay pistas en la cola para mezclar."
                : `Cola mezclada (${shuffled} pistas).`,
            );
          }
          break;
        case "now-playing":
          await send(
            playback.current
              ? `Reproduciendo: ${playback.current.title} (${formatDuration(playback.current.durationSeconds)} - por ${playback.current.requestedBy})`
              : "No hay nada reproduciéndose.",
          );
          break;
        case "skip":
          playback.skip();
          await send("Pista saltada.");
          break;
        case "stats": {
          const ytdlp = ytDlpExecutor.metrics();
          const current = playback.current;
          const currentArg =
            current !== undefined
              ? {
                  title: current.title,
                  ...(current.durationSeconds === undefined
                    ? {}
                    : { durationSeconds: current.durationSeconds }),
                }
              : undefined;
          const statsOutput = metrics.formatStats({
            ...(currentArg !== undefined ? { current: currentArg } : {}),
            loopMode: playback.loopMode,
            queueLen: playback.queue().length,
            tracksPlayed: playback.tracksPlayed,
            uptimeSec: process.uptime(),
            volume: playback.volume,
            ytdlpActive: ytdlp.active,
            ytdlpQueued: ytdlp.queued,
          });
          await send(statsOutput);
          break;
        }
        case "diag": {
          if (!isAdminUid(senderUid, adminUids)) {
            await send("Solo los administradores pueden usar este comando.");
            break;
          }
          await send(metrics.formatDiag());
          break;
        }
        case "debug-server": {
          if (!isAdminUid(senderUid, adminUids)) {
            await send("Solo los administradores pueden usar este comando.");
            break;
          }
          const [serverInfo, clients, channels] = await Promise.all([
            connection.getServerInfo(),
            connection.listClients(),
            connection.listChannels(),
          ]);
          const botClient = clients.find(
            (c) => c.name === config.RHAPSOD_TS3_NICKNAME,
          );
          const botChannel = channels.find(
            (ch) => ch.cid === (botClient?.cid ?? -1),
          );
          const lines = [
            `=== Server: ${serverInfo.virtualserver_name ?? "?"} ===`,
            `Version: ${serverInfo.virtualserver_version ?? "?"}`,
            `Clients: ${clients.length}/${serverInfo.virtualserver_maxclients ?? "?"}`,
            `Canal del bot: ${botChannel?.name ?? "?"} (cid ${botClient?.cid ?? "?"})`,
            `Talk power del bot: ${botClient?.talkPower ?? "?"}`,
            "",
            `=== Canales (${channels.length}) ===`,
            ...channels.map((ch) => {
              const inChannel = clients.filter((c) => c.cid === ch.cid);
              return `  ${ch.name} (cid ${ch.cid}) [${inChannel.length}]: ${inChannel.map((c) => c.name).join(", ") || "(vacío)"}`;
            }),
          ];
          await send(lines.join("\n"));
          break;
        }
        case "chart": {
          if (!isAdminUid(senderUid, adminUids)) {
            await send("Solo los administradores pueden usar este comando.");
            break;
          }
          const top = telemetry.snapshot().slice(0, 20);
          if (top.length === 0) {
            await send("Todavía no hay datos de telemetría de usuarios.");
            break;
          }
          const lines = [
            `=== Telemetría (${telemetry.snapshot().length} usuarios) ===`,
            ...top.map(
              (u, i) =>
                `${i + 1}. ${u.names[u.names.length - 1] ?? "?"} | grupos [${u.serverGroupIds.join(",")}] | talk ${u.maxTalkPower} | cmds ${u.commandCount} | movió bot ${u.botMovedBy} | entró a canal bot ${u.botChannelEntries}`,
            ),
          ];
          await send(lines.join("\n"));
          break;
        }
        case "stop":
          playback.stop();
          await send("Reproducción detenida.");
          break;
        case "test-tone":
          {
            if (playback.current) {
              await send(
                "No puedo reproducir el tono mientras hay música. Probá con !stop o esperá a que termine la pista.",
              );
              break;
            }
            const toneLimit = commandRateLimiter.acquire(
              "global:test-tone",
              30_000,
            );
            if (!toneLimit.allowed) {
              if (
                commandRateLimiter.acquire("global:test-tone-feedback", 5_000)
                  .allowed
              ) {
                await send(
                  `El tono estará disponible en ${Math.ceil(toneLimit.retryAfterMs / 1_000)} s.`,
                );
              }
              break;
            }
          }
          await send("Reproduciendo tono de prueba (3 s)...");
          await playTestTone(3, encoder, connection);
          await send("Tono de prueba terminado.");
          break;
        case "help":
          await send(
            [
              "Comandos disponibles:",
              "!play <URL o búsqueda> - Reproducir YouTube, SoundCloud, Spotify, playlists o buscar",
              "!playnext (!pn) <URL o búsqueda> - Agregar como próxima pista",
              "!yt [n] <búsqueda> - Buscar en YouTube (el resultado n con un número)",
              "!queue [página] - Mostrar la cola",
              "!history (!hist) - Historial reciente",
              "!now-playing (!np) - Canción actual",
              "!move (!mv) <origen> <destino> - Mover una pista",
              "!channel-move (!ch) <canal> - Mover el bot (solo admins)",
              "!remove <n|a-b> - Quitar una posición o rango",
              "!clear - Vaciar la cola",
              "!shuffle - Mezclar la cola",
              "!skip - Saltar la canción",
              "!stop - Detener y vaciar",
              "!pause / !resume - Pausar o continuar",
              "!test-tone - Probar el audio",
              "!volume <0-100> - Ajustar el volumen",
              "!loop [off|track|queue] - Repetir la pista o la cola",
              "!lyrics (!ly) - Letra de la canción actual",
              "!stats (!st) - Estado del bot (solo lectura)",
              "!debug-server (!ds) - Info del servidor TS3 (solo admins)",
              "!help - Mostrar esta ayuda",
            ].join("\n"),
          );
          break;
        case "loop":
          if (command.mode) {
            playback.setLoopMode(command.mode);
            await send(
              command.mode === "off"
                ? "Modo loop desactivado."
                : command.mode === "track"
                  ? "Modo loop: pista actual en repetición."
                  : "Modo loop: cola en repetición.",
            );
          } else {
            await send(
              `Modo loop actual: ${playback.loopMode}. Usá !loop [off|track|queue].`,
            );
          }
          break;
        case "volume":
          playback.setVolume(command.value);
          await send(`Volumen ajustado a ${playback.volume}%.`);
          break;
        case "lyrics": {
          if (!playback.current) {
            await send("No hay nada reproduciéndose.");
            break;
          }
          await send("Buscando la letra...");
          const lyrics = await playback.getLyrics();
          if (!lyrics) {
            await send(`No encontré la letra de: ${playback.current.title}`);
            break;
          }
          const title = lyrics.artist
            ? `${lyrics.artist} - ${lyrics.title}`
            : lyrics.title;
          const maxChars = 1_600;
          const body =
            lyrics.plainLyrics.length > maxChars
              ? `${lyrics.plainLyrics.slice(0, maxChars)}…`
              : lyrics.plainLyrics;
          await send(`${title}\n${body}`);
          break;
        }
      }
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
        "Reconnect limit reached; stopping bot",
      );
      shuttingDown = true;
      stopHeartbeat();
      await connection.disconnect().catch(() => undefined);
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
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]).then(() => {
      logger.info("Shutdown complete");
      process.exit(0);
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

function formatDuration(durationSeconds: number | undefined): string {
  if (durationSeconds === undefined) return "duración desconocida";
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function userFacingError(error: Error): string {
  if (/DRM protected/i.test(error.message)) {
    return "SoundCloud no permite reproducir esta pista porque está protegida con DRM. Probá otra versión o una fuente distinta.";
  }
  if (/Requested format is not available/i.test(error.message)) {
    return "YouTube no ofrece un formato de audio reproducible para ese video (puede ser un directo o un video restringido). Probá otra versión.";
  }
  if (/fetch failed/i.test(error.message)) {
    return "Fallo momentáneo de red con el proveedor (Spotify/YouTube). Probá de nuevo en unos segundos.";
  }
  return error.message;
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unknown startup error";
  process.stderr.write(`Rhapsod failed to start: ${message}\n`);
  process.exitCode = 1;
});
