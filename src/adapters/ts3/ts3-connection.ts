import {
  Client,
  sendTextMessage,
  type Identity,
} from "@honeybbq/teamspeak-client";

import type { AppConfig } from "../../config.js";

export interface Ts3Connection {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onTextMessage(
    handler: (message: string, senderUid: string, senderName: string) => void,
  ): void;
  sendChannelMessage(message: string): Promise<void>;
  sendVoiceFrame(frame: Uint8Array): void;
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
    connect: async () => {
      await client.connect();
      await client.waitConnected(
        AbortSignal.timeout(config.RHAPSOD_TS3_CONNECT_TIMEOUT_SECONDS * 1_000),
      );
    },
    disconnect: () => client.disconnect(),
    sendChannelMessage: (message) =>
      sendTextMessage(client, 2, client.channelID(), message),
    sendVoiceFrame: (frame) => client.sendVoice(frame, 5),
    onTextMessage: (handler) => {
      client.on("textMessage", (message) =>
        handler(message.message, message.invokerUID, message.invokerName),
      );
    },
  };
}
