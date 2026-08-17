import { Client, type Identity } from "@honeybbq/teamspeak-client";

import type { AppConfig } from "../../config.js";

export interface Ts3Connection {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onTextMessage(handler: (message: string, senderUid: string) => void): void;
}

export function createTs3Connection(
  config: AppConfig,
  identity: Identity,
): Ts3Connection {
  const client = new Client(
    identity,
    `${config.RHAPSOD_TS3_HOST}:${config.RHAPSOD_TS3_PORT}`,
    config.RHAPSOD_TS3_NICKNAME,
    {
      ...(config.RHAPSOD_TS3_CHANNEL_NAME === undefined
        ? {}
        : { defaultChannel: config.RHAPSOD_TS3_CHANNEL_NAME }),
      ...(config.RHAPSOD_TS3_CHANNEL_PASSWORD === undefined
        ? {}
        : { defaultChannelPassword: config.RHAPSOD_TS3_CHANNEL_PASSWORD }),
      ...(config.RHAPSOD_TS3_PASSWORD === undefined
        ? {}
        : { serverPassword: config.RHAPSOD_TS3_PASSWORD }),
    },
  );

  return {
    connect: () => client.connect(),
    disconnect: () => client.disconnect(),
    onTextMessage: (handler) => {
      client.on("textMessage", (message) =>
        handler(message.message, message.invokerUID),
      );
    },
  };
}
