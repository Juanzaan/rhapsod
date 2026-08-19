import "dotenv/config";

import { join } from "node:path";

import pino from "pino";

import { Ts3IdentityStore } from "./adapters/ts3/identity-store.js";
import { createTs3Connection } from "./adapters/ts3/ts3-connection.js";
import { createRhapsodOpusEncoder } from "./audio/opus-encoder.js";
import { playFfmpegUrl } from "./audio/ffmpeg-player.js";
import { playTestTone } from "./audio/test-tone-player.js";
import { YoutubePlaybackService } from "./application/youtube-playback-service.js";
import { parseChatCommand } from "./commands/chat-command.js";
import { CommandRateLimiter } from "./commands/command-rate-limiter.js";
import { loadConfig } from "./config.js";
import {
  SystemYtDlpExecutor,
  YoutubeResolver,
} from "./media/youtube/yt-dlp.js";
import { SongLinkClient } from "./media/song-link.js";
import { SoundCloudPublicApi } from "./media/soundcloud/public-api.js";
import { SpotifyApi } from "./media/spotify/api.js";
import { parseMediaInput } from "./media/media-input.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = pino({ level: config.RHAPSOD_LOG_LEVEL });

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
  const connection = createTs3Connection(config, identity);
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
        })
      : undefined;
  const ffmpegPath = config.RHAPSOD_FFMPEG_PATH;
  const playback = new YoutubePlaybackService({
    createPlayback: (url, playbackEncoder, output) =>
      playFfmpegUrl(url, playbackEncoder, output, {
        ...(ffmpegPath === undefined ? {} : { binary: ffmpegPath }),
        loudnessTargetLufs: config.RHAPSOD_LOUDNESS_TARGET_LUFS,
      }),
    encoder,
    onPlaybackStarted: async (track) => {
      await connection.sendChannelMessage(`Reproduciendo: ${track.title}`);
    },
    onPlaybackFinished: (track, metrics, reason) => {
      logger.info(
        { ...metrics, reason, trackId: track.id },
        "Playback metrics",
      );
    },
    onTiming: (timing) => {
      logger.info(timing, "Playback timing");
    },
    onPlaybackError: async (track, error) => {
      logger.error({ error, trackId: track.id }, "YouTube playback failed");
      await connection.sendChannelMessage(
        `Error reproduciendo ${track.title}: ${error.message}`,
      );
    },
    output: connection,
    resolver: new YoutubeResolver(
      new SystemYtDlpExecutor(
        config.RHAPSOD_YTDLP_PATH,
        config.RHAPSOD_YTDLP_COOKIES_PATH,
      ),
    ),
    alternativeResolver: new SongLinkClient(),
    soundcloudResolver: new SoundCloudPublicApi(),
    ...(spotifyResolver ? { spotifyResolver } : {}),
  });
  const commandRateLimiter = new CommandRateLimiter();
  const handleChatCommand = async (
    message: string,
    senderUid: string,
    senderName: string,
  ): Promise<void> => {
    try {
      const command = parseChatCommand(message);
      if (!command) return;
      if (!commandRateLimiter.acquire(`user:${senderUid}`, 1_500).allowed) {
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
            );
            const message =
              result.added.length === 0
                ? "La playlist o álbum no tiene canciones reproducibles."
                : `Se agregaron ${result.added.length} canciones a la cola${result.remaining ? ` (quedan ${result.remaining} fuera del límite)` : ""}.`;
            await connection.sendChannelMessage(message);
          } else {
            const track = await playback.enqueue(command.input, senderName);
            const viaSearch = media.kind === "file";
            await connection.sendChannelMessage(
              `En cola: ${track.title}${viaSearch ? " (búsqueda)" : ""}`,
            );
          }
          break;
        }
        case "search": {
          await connection.sendChannelMessage("Buscando en YouTube...");
          const track = await playback.enqueueSearch(command.input, senderName);
          await connection.sendChannelMessage(`En cola: ${track.title}`);
          break;
        }
        case "pause":
          playback.pause();
          await connection.sendChannelMessage("Reproducción pausada.");
          break;
        case "resume":
          playback.resume();
          await connection.sendChannelMessage("Reproducción reanudada.");
          break;
        case "queue": {
          const tracks = playback.queue();
          await connection.sendChannelMessage(
            tracks.length === 0
              ? "La cola está vacía."
              : [
                  "Cola de reproducción:",
                  ...tracks.map(
                    (track, index) =>
                      `${index + 1}. ${track.title} (${formatDuration(track.durationSeconds)} - por ${track.requestedBy})`,
                  ),
                ].join("\n"),
          );
          break;
        }
        case "remove": {
          const removed = playback.removeQueued(command.position);
          await connection.sendChannelMessage(
            removed
              ? `Quitada de la cola: ${removed.title}`
              : "No existe esa posición en la cola.",
          );
          break;
        }
        case "clear": {
          const cleared = playback.clearQueued();
          await connection.sendChannelMessage(
            cleared === 0
              ? "La cola ya estaba vacía."
              : `Se quitaron ${cleared} pistas de la cola.`,
          );
          break;
        }
        case "shuffle": {
          const shuffled = playback.shuffleQueued();
          await connection.sendChannelMessage(
            shuffled === 0
              ? "No hay pistas en la cola para mezclar."
              : `Cola mezclada (${shuffled} pistas).`,
          );
          break;
        }
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
        case "stop":
          playback.stop();
          await connection.sendChannelMessage("Reproducción detenida.");
          break;
        case "test-tone":
          {
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
              "!yt <búsqueda> - Buscar en YouTube",
              "!queue - Mostrar la cola",
              "!now-playing (!np) - Canción actual",
              "!remove <n> - Quitar una posición",
              "!clear - Vaciar la cola",
              "!shuffle - Mezclar la cola",
              "!skip - Saltar la canción",
              "!stop - Detener y vaciar",
              "!pause / !resume - Pausar o continuar",
              "!test-tone - Probar el audio",
              "!volume <0-100> - Ajustar el volumen",
              "!loop [off|track|queue] - Repetir la pista o la cola",
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
      }
    } catch (error) {
      logger.warn({ command: message, error }, "Command failed");
      const messageText =
        error instanceof Error
          ? userFacingError(error)
          : "Error procesando comando";
      await connection.sendChannelMessage(messageText);
    }
  };
  connection.onTextMessage((message, senderUid, senderName) => {
    void handleChatCommand(message, senderUid, senderName);
  });
  await connection.connect();
  logger.info("Connected to TeamSpeak 3");

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
    playback.stop();
    encoder.close();
    void connection.disconnect().finally(() => process.exit(0));
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
