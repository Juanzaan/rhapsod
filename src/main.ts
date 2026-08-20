import "dotenv/config";

import { join } from "node:path";

import { Ts3IdentityStore } from "./adapters/ts3/identity-store.js";
import { createTs3Connection } from "./adapters/ts3/ts3-connection.js";
import { createRhapsodOpusEncoder } from "./audio/opus-encoder.js";
import { playFfmpegUrl } from "./audio/ffmpeg-player.js";
import { playTestTone } from "./audio/test-tone-player.js";
import { YoutubePlaybackService } from "./application/youtube-playback-service.js";
import { AudioUrlCache } from "./application/audio-url-cache.js";
import { parseChatCommand } from "./commands/chat-command.js";
import { CommandRateLimiter } from "./commands/command-rate-limiter.js";
import { loadConfig } from "./config.js";
import { FilePlaybackStateStore } from "./domain/state-store.js";
import { canRemoveTrack, parseAdminUids } from "./commands/permissions.js";
import {
  SystemYtDlpExecutor,
  YoutubeResolver,
} from "./media/youtube/yt-dlp.js";
import { SongLinkClient } from "./media/song-link.js";
import { DirectUrlClient } from "./media/direct-url.js";
import { LyricsClient } from "./media/lyrics.js";
import { SoundCloudPublicApi } from "./media/soundcloud/public-api.js";
import { SpotifyApi } from "./media/spotify/api.js";
import { parseMediaInput } from "./media/media-input.js";
import { createRhapsodLogger } from "./observability/logger.js";
import { startWatchdog } from "./watchdog.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = await createRhapsodLogger({
    level: config.RHAPSOD_LOG_LEVEL,
    logDir: join(config.RHAPSOD_DATA_DIR, "logs"),
    retentionDays: config.RHAPSOD_LOG_RETENTION_DAYS,
  });
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
  if (metricsIntervalMinutes > 0) {
    const reportMetrics = (): void => {
      const { heapUsed, rss } = process.memoryUsage();
      logger.info(
        {
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
  const connection = createTs3Connection(config, identity);
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
        })
      : undefined;
  const ffmpegPath = config.RHAPSOD_FFMPEG_PATH;
  const ffmpegUserAgent = config.RHAPSOD_FFMPEG_USER_AGENT;
  const ytDlpExecutor = new SystemYtDlpExecutor(
    config.RHAPSOD_YTDLP_PATH,
    config.RHAPSOD_YTDLP_COOKIES_PATH,
  );
  const audioUrlCache = AudioUrlCache.load(
    join(config.RHAPSOD_DATA_DIR, "audio-url-cache.json"),
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
      logger.info(timing, "Playback timing");
    },
    onPlaybackError: async (track, error) => {
      logger.error({ error, trackId: track.id }, "YouTube playback failed");
      await connection.sendChannelMessage(
        `Error reproduciendo ${track.title}: ${error.message}`,
      );
    },
    output: connection,
    resolver: new YoutubeResolver(ytDlpExecutor),
    stateStore: new FilePlaybackStateStore(
      join(config.RHAPSOD_DATA_DIR, "state.json"),
    ),
    audioUrlCache,
    maxQueueTracks: config.RHAPSOD_MAX_QUEUE_TRACKS,
    maxTracksPerUser: config.RHAPSOD_MAX_TRACKS_PER_USER,
    alternativeResolver: new SongLinkClient(),
    directUrlResolver: new DirectUrlClient({
      ...(config.RHAPSOD_FFPROBE_PATH === undefined
        ? {}
        : { ffprobeBinary: config.RHAPSOD_FFPROBE_PATH }),
    }),
    soundcloudResolver: new SoundCloudPublicApi(),
    lyricsResolver: new LyricsClient(),
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
  const handleChatCommand = async (
    message: string,
    senderUid: string,
    senderName: string,
  ): Promise<void> => {
    try {
      const command = parseChatCommand(message);
      if (!command) return;
      logger.info({ command: message, senderName, senderUid }, "Chat command");
      const rateGate = commandRateLimiter.acquire(`user:${senderUid}`, 1_500);
      if (!rateGate.allowed) {
        if (Date.now() - rateLimitFeedbackAt > 5_000) {
          rateLimitFeedbackAt = Date.now();
          await connection.sendChannelMessage(
            `Esperá un momento entre comandos (${Math.ceil(rateGate.retryAfterMs / 1_000)} s).`,
          );
        }
        return;
      }
      switch (command.name) {
        case "play": {
          await connection.sendChannelMessage("Preparando la reproducción...");
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
            await connection.sendChannelMessage(message);
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
            await connection.sendChannelMessage(message);
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
            await connection.sendChannelMessage(message);
          } else {
            const track = await playback.enqueue(
              command.input,
              senderName,
              senderUid,
            );
            const viaSearch = media.kind === "file";
            await connection.sendChannelMessage(
              `En cola: ${track.title}${viaSearch ? " (búsqueda)" : ""}`,
            );
          }
          break;
        }
        case "playnext": {
          await connection.sendChannelMessage("Preparando la próxima pista...");
          const track = await playback.enqueueNext(
            command.input,
            senderName,
            senderUid,
          );
          await connection.sendChannelMessage(
            `Próxima en cola: ${track.title}`,
          );
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
            await connection.sendChannelMessage(
              `En cola (resultado ${command.index}): ${track.title}`,
            );
            break;
          }
          await connection.sendChannelMessage("Buscando en YouTube...");
          const track = await playback.enqueueSearch(
            command.input,
            senderName,
            senderUid,
          );
          await connection.sendChannelMessage(`En cola: ${track.title}`);
          break;
        }
        case "pause":
          playback.pause();
          await connection.sendChannelMessage("Reproducción pausada.");
          break;
        case "previous": {
          const track = playback.replayPrevious();
          await connection.sendChannelMessage(
            `Reproduciendo de nuevo: ${track.title}`,
          );
          break;
        }
        case "resume":
          playback.resume();
          await connection.sendChannelMessage("Reproducción reanudada.");
          break;
        case "seek":
          playback.seek(command.seconds);
          await connection.sendChannelMessage(
            `Reproduciendo desde el segundo ${command.seconds}…`,
          );
          break;
        case "queue": {
          const tracks = playback.queue();
          const pageSize = 10;
          const pages = Math.max(1, Math.ceil(tracks.length / pageSize));
          const page = command.page ?? 1;
          await connection.sendChannelMessage(
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
          await connection.sendChannelMessage(
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
          await connection.sendChannelMessage(
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
            await connection.sendChannelMessage(
              "Solo el administrador del bot puede quitar rangos con pistas de otros usuarios.",
            );
            break;
          }
          const removed = playback.removeQueuedRange(command.from, command.to);
          await connection.sendChannelMessage(
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
            await connection.sendChannelMessage(
              cleared === 0
                ? "La cola ya estaba vacía."
                : `Se quitaron ${cleared} pistas de la cola.`,
            );
          }
          break;
        case "shuffle":
          {
            const shuffled = playback.shuffleQueued();
            await connection.sendChannelMessage(
              shuffled === 0
                ? "No hay pistas en la cola para mezclar."
                : `Cola mezclada (${shuffled} pistas).`,
            );
          }
          break;
        case "now-playing":
          await connection.sendChannelMessage(
            playback.current
              ? `Reproduciendo: ${playback.current.title} (${formatDuration(playback.current.durationSeconds)} - por ${playback.current.requestedBy})`
              : "No hay nada reproduciéndose.",
          );
          break;
        case "skip":
          playback.skip();
          await connection.sendChannelMessage("Pista saltada.");
          break;
        case "stats": {
          const uptimeSeconds = process.uptime();
          const hours = Math.floor(uptimeSeconds / 3_600);
          const minutes = Math.floor((uptimeSeconds % 3_600) / 60);
          const lines = [
            `Uptime: ${hours}h ${minutes}m`,
            `Canciones reproducidas: ${playback.tracksPlayed}`,
            playback.current
              ? `Actual: ${playback.current.title} (${formatDuration(playback.current.durationSeconds)})`
              : "Actual: nada reproduciéndose",
            `En cola: ${playback.queue().length} pista(s)`,
            `Volumen: ${playback.volume}% - Loop: ${playback.loopMode}`,
          ];
          await connection.sendChannelMessage(lines.join("\n"));
          break;
        }
        case "stop":
          playback.stop();
          await connection.sendChannelMessage("Reproducción detenida.");
          break;
        case "test-tone":
          {
            if (playback.current) {
              await connection.sendChannelMessage(
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
                await connection.sendChannelMessage(
                  `El tono estará disponible en ${Math.ceil(toneLimit.retryAfterMs / 1_000)} s.`,
                );
              }
              break;
            }
          }
          await connection.sendChannelMessage(
            "Reproduciendo tono de prueba (3 s)...",
          );
          await playTestTone(3, encoder, connection);
          await connection.sendChannelMessage("Tono de prueba terminado.");
          break;
        case "help":
          await connection.sendChannelMessage(
            [
              "Comandos disponibles:",
              "!play <URL o búsqueda> - Reproducir YouTube, SoundCloud, Spotify, playlists o buscar",
              "!playnext (!pn) <URL o búsqueda> - Agregar como próxima pista",
              "!yt [n] <búsqueda> - Buscar en YouTube (el resultado n con un número)",
              "!queue [página] - Mostrar la cola",
              "!history (!hist) - Historial reciente",
              "!now-playing (!np) - Canción actual",
              "!move (!mv) <origen> <destino> - Mover una pista",
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
              "!help - Mostrar esta ayuda",
            ].join("\n"),
          );
          break;
        case "loop":
          if (command.mode) {
            playback.setLoopMode(command.mode);
            await connection.sendChannelMessage(
              command.mode === "off"
                ? "Modo loop desactivado."
                : command.mode === "track"
                  ? "Modo loop: pista actual en repetición."
                  : "Modo loop: cola en repetición.",
            );
          } else {
            await connection.sendChannelMessage(
              `Modo loop actual: ${playback.loopMode}. Usá !loop [off|track|queue].`,
            );
          }
          break;
        case "volume":
          playback.setVolume(command.value);
          await connection.sendChannelMessage(
            `Volumen ajustado a ${playback.volume}%.`,
          );
          break;
        case "lyrics": {
          if (!playback.current) {
            await connection.sendChannelMessage("No hay nada reproduciéndose.");
            break;
          }
          await connection.sendChannelMessage("Buscando la letra...");
          const lyrics = await playback.getLyrics();
          if (!lyrics) {
            await connection.sendChannelMessage(
              `No encontré la letra de: ${playback.current.title}`,
            );
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
          await connection.sendChannelMessage(`${title}\n${body}`);
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
      await connection.sendChannelMessage(messageText).catch(() => undefined);
    }
  };
  connection.onTextMessage((message, senderUid, senderName) => {
    if (activeCommands >= maxConcurrentCommands) {
      if (Date.now() - busyFeedbackAt > 5_000) {
        busyFeedbackAt = Date.now();
        void connection
          .sendChannelMessage(
            "El bot está procesando varios pedidos a la vez; probá de nuevo en unos segundos.",
          )
          .catch(() => undefined);
      }
      return;
    }
    activeCommands++;
    void handleChatCommand(message, senderUid, senderName).finally(() => {
      activeCommands--;
    });
  });
  await connection.connect();
  logger.info("Connected to TeamSpeak 3");

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
          reconnecting = false;
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

  const shutdown = (): void => {
    playback.stop(false);
    encoder.close();
    stopHeartbeat();
    const disconnect = connection.disconnect();
    void Promise.all([
      disconnect.catch(() => undefined),
      playback.flushState().catch(() => undefined),
      audioUrlCache.flush().catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]).then(() => process.exit(0));
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
