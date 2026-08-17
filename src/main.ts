import "dotenv/config";

import { join } from "node:path";

import pino from "pino";

import { Ts3IdentityStore } from "./adapters/ts3/identity-store.js";
import { createTs3Connection } from "./adapters/ts3/ts3-connection.js";
import { loadConfig } from "./config.js";

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
  connection.onTextMessage((message, senderUid) => {
    logger.debug({ message, senderUid }, "Received TeamSpeak text message");
  });
  await connection.connect();
  logger.info("Connected to TeamSpeak 3");

  const shutdown = (): void => {
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
