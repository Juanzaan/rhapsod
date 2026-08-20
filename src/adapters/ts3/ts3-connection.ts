import {
  Client,
  listClients,
  sendTextMessage,
  type Identity,
} from "@honeybbq/teamspeak-client";

import type { AppConfig } from "../../config.js";

interface Ts3Connection {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listConnectedClientUids(): Promise<readonly string[]>;
  canTalkInCurrentChannel(): Promise<boolean>;
  onConnectionLost(
    handler: (reason: "kicked" | "disconnected") => void,
  ): () => void;
  onClientMoved(handler: () => void): void;
  onTextMessage(
    handler: (message: string, senderUid: string, senderName: string) => void,
  ): void;
  sendChannelMessage(message: string): Promise<void>;
  sendVoiceFrame(frame: Uint8Array): void;
}

export function canTalkInChannel(
  clientInfo: Record<string, string>,
  channelInfo: Record<string, string>,
): boolean {
  const talkPower = Number(clientInfo.client_talk_power ?? 0);
  const neededPower = Number(channelInfo.channel_needed_talk_power ?? 0);
  if (talkPower < neededPower) return false;
  if (channelInfo.channel_flag_moderated === "1") {
    return clientInfo.client_is_talker === "1";
  }
  return true;
}

export function createHeartbeat(
  probe: () => Promise<void>,
  intervalMs: number,
  onLost: () => void,
  requiredFailures = 2,
): () => void {
  let consecutiveFailures = 0;
  const timer = setInterval(() => {
    void probe()
      .then(() => {
        consecutiveFailures = 0;
      })
      .catch(() => {
        consecutiveFailures++;
        if (consecutiveFailures >= requiredFailures) {
          consecutiveFailures = 0;
          onLost();
        }
      });
  }, intervalMs);
  return () => clearInterval(timer);
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
      try {
        await client.connect();
        await client.waitConnected(
          AbortSignal.timeout(
            config.RHAPSOD_TS3_CONNECT_TIMEOUT_SECONDS * 1_000,
          ),
        );
      } catch (error) {
        await client.disconnect().catch(() => undefined);
        throw error;
      }
      if (config.RHAPSOD_TS3_CLIENT_DESCRIPTION !== undefined) {
        try {
          await client.execCommand(
            `clientset client_description=${escapeClientParam(config.RHAPSOD_TS3_CLIENT_DESCRIPTION)}`,
          );
        } catch {
          // The description is cosmetic; keep the connection alive either way.
        }
      }
      if (config.RHAPSOD_TS3_CHANNEL_ID !== undefined) {
        try {
          await client.execCommand(
            `clientmove clid=${client.clientID()} cid=${config.RHAPSOD_TS3_CHANNEL_ID}`,
          );
        } catch {
          // Some servers forbid self-moves; the user moves the bot manually.
        }
      }
    },
    disconnect: () => client.disconnect(),
    listConnectedClientUids: async () => {
      try {
        const clients = await listClients(client);
        return clients
          .filter((entry) => entry.type === 0)
          .map((entry) => entry.uid);
      } catch {
        return [];
      }
    },
    canTalkInCurrentChannel: async () => {
      try {
        const [clientInfo, channelInfo] = await Promise.all([
          client.execCommandWithResponse(
            `clientinfo clid=${client.clientID()}`,
          ),
          client.execCommandWithResponse(
            `channelinfo cid=${client.channelID()}`,
          ),
        ]);
        return canTalkInChannel(clientInfo[0] ?? {}, channelInfo[0] ?? {});
      } catch {
        // Be permissive if the check itself fails.
        return true;
      }
    },
    onClientMoved: (handler) => {
      client.on("clientMoved", (event) => {
        if (event.id === client.clientID()) handler();
      });
    },
    onConnectionLost: (handler) => {
      client.on("kicked", () => handler("kicked"));
      client.on("disconnected", () => handler("disconnected"));
      const heartbeatSeconds = config.RHAPSOD_TS3_HEARTBEAT_SECONDS;
      if (heartbeatSeconds > 0) {
        return createHeartbeat(
          () => listClients(client).then(() => undefined),
          heartbeatSeconds * 1_000,
          () => handler("disconnected"),
        );
      }
      return () => undefined;
    },
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

function escapeClientParam(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replaceAll(String.fromCharCode(7), "\\a")
    .replaceAll(String.fromCharCode(8), "\\b")
    .replaceAll(String.fromCharCode(12), "\\f")
    .replaceAll(String.fromCharCode(11), "\\v")
    .replace(/\s/g, "\\s")
    .replace(/\//g, "\\/")
    .replace(/\|/g, "\\p");
}
