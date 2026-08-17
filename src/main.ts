import "dotenv/config";

import { join } from "node:path";

import pino from "pino";

import { Ts3IdentityStore } from "./adapters/ts3/identity-store.js";
import { createTs3Connection } from "./adapters/ts3/ts3-connection.js";
import { createRhapsodOpusEncoder } from "./audio/opus-encoder.js";
import { playTestTone } from "./audio/test-tone-player.js";
import { YoutubePlaybackService } from "./application/youtube-playback-service.js";
import { parseChatCommand } from "./commands/chat-command.js";
import { loadConfig } from "./config.js";
import {
  SystemYtDlpExecutor,
  YoutubeResolver,
} from "./media/youtube/yt-dlp.js";

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
  const connection = createTs3Connection(config, identity);
  const encoder = await createRhapsodOpusEncoder({
    bitrate: config.RHAPSOD_OPUS_BITRATE,
  });
  const playback = new YoutubePlaybackService({
    encoder,
    output: connection,
    resolver: new YoutubeResolver(
      new SystemYtDlpExecutor(config.RHAPSOD_YTDLP_PATH),
    ),
  });
  const handleChatCommand = async (
    message: string,
    senderUid: string,
  ): Promise<void> => {
    try {
      const command = parseChatCommand(message);
      if (!command) return;
      switch (command.name) {
        case "play": {
          const track = await playback.enqueue(command.input, senderUid);
          await connection.sendChannelMessage(`En cola: ${track.title}`);
          break;
        }
        case "queue": {
          const tracks = playback.queue();
          await connection.sendChannelMessage(
            tracks.length === 0
              ? "La cola está vacía."
              : tracks
                  .map((track, index) => `${index + 1}. ${track.title}`)
                  .join(" | "),
          );
          break;
        }
        case "now-playing":
          await connection.sendChannelMessage(
            playback.current
              ? `Reproduciendo: ${playback.current.title}`
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
        case "help":
          await connection.sendChannelMessage(
            "Comandos: !play <YouTube> !queue !now-playing !skip !stop",
          );
          break;
        default:
          await connection.sendChannelMessage(
            `Comando !${command.name} todavía no está conectado.`,
          );
      }
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : "Error procesando comando";
      await connection.sendChannelMessage(messageText);
    }
  };
  connection.onTextMessage((message, senderUid) => {
    void handleChatCommand(message, senderUid);
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

void main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unknown startup error";
  process.stderr.write(`Rhapsod failed to start: ${message}\n`);
  process.exitCode = 1;
});
