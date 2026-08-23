import { Client, listClients, type Identity } from "@honeybbq/teamspeak-client";

import type { Logger } from "pino";

import type { AppConfig } from "../../config.js";

const MESSAGE_SEND_TIMEOUT_MS = 10_000;

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    timer.unref();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

interface Ts3Connection {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listChannels(): Promise<readonly { cid: number; name: string }[]>;
  getCurrentChannel(): Promise<{
    readonly cid: number;
    readonly name?: string;
  }>;
  getCurrentChannelId(): number;
  listConnectedClientUids(): Promise<readonly string[]>;
  canTalkInCurrentChannel(): Promise<boolean>;
  moveToChannel(cid: number): Promise<void>;
  getServerInfo(): Promise<Record<string, string>>;
  getClientInfo(clid: number): Promise<Record<string, string>>;
  getChannelInfo(cid: number): Promise<Record<string, string>>;
  listClients(): Promise<
    readonly {
      clid: number;
      name: string;
      uid: string;
      cid: number;
      talkPower?: number;
      groups?: readonly string[];
    }[]
  >;
  getServerGroupPermissions(
    sgid: number,
  ): Promise<
    readonly { permid: string; permvalue: string; permskip?: string }[]
  >;
  onConnectionLost(
    handler: (reason: "kicked" | "disconnected") => void,
  ): () => void;
  onClientMoved(
    handler: (event: {
      readonly movedClid: number;
      readonly targetCid: number;
      readonly invokerName: string;
      readonly invokerUid: string;
      readonly invokerClid: number;
      readonly self: boolean;
    }) => void,
  ): void;
  onClientEnter(
    handler: (event: {
      readonly clid: number;
      readonly name: string;
      readonly uid: string;
      readonly groups: readonly string[];
      readonly cid: number;
    }) => void,
  ): void;
  onClientLeave(handler: (clid: number) => void): void;
  onTextMessage(
    handler: (
      message: string,
      senderUid: string,
      senderName: string,
      senderGroups: readonly string[],
      isPrivate: boolean,
      invokerClid: number,
    ) => void,
  ): void;
  sendChannelMessage(message: string): Promise<void>;
  sendPrivateMessage(clid: number, message: string): Promise<void>;
  sendVoiceFrame(frame: Uint8Array): void;
}

export function canTalkInChannel(
  clientInfo: Record<string, string>,
  channelInfo: Record<string, string>,
): boolean {
  const neededPower = Number(channelInfo.channel_needed_talk_power ?? 0);
  if (clientInfo.client_talk_power !== undefined) {
    const talkPower = Number(clientInfo.client_talk_power);
    if (talkPower < neededPower) return false;
  } else if (neededPower >= 100_000) {
    // The server hides our talk power and the channel demands an
    // effectively impossible amount: nobody can talk there.
    return false;
  }
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
  logger: Logger,
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
        } catch (error) {
          logger.warn(
            {
              configuredChannelId: config.RHAPSOD_TS3_CHANNEL_ID,
              errorMessage:
                error instanceof Error ? error.message : String(error),
            },
            "Failed to move bot to configured TeamSpeak channel",
          );
        }
      }
    },
    disconnect: () => client.disconnect(),
    listChannels: async () => {
      try {
        const rows = await client.execCommandWithResponse("channellist");
        return rows
          .filter(
            (
              row,
            ): row is Record<string, string> & { cid: string; name: string } =>
              typeof row.cid === "string" && typeof row.name === "string",
          )
          .map((row) => ({ cid: Number(row.cid), name: row.name }));
      } catch (error) {
        logger.error({ err: error, command: "channellist" }, "Failed to list channels");
        return [];
      }
    },
    getCurrentChannel: async () => {
      const cid = Number(client.channelID());
      try {
        const rows = await client.execCommandWithResponse(
          `channelinfo cid=${cid}`,
        );
        const name = rows[0]?.channel_name;
        return name === undefined ? { cid } : { cid, name };
      } catch (error) {
        logger.debug(
          {
            channelId: cid,
            errorMessage:
              error instanceof Error ? error.message : String(error),
          },
          "Failed to read current TeamSpeak channel",
        );
        return { cid };
      }
    },
    getCurrentChannelId: () => Number(client.channelID()),
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
    moveToChannel: async (cid: number) => {
      await client.execCommand(
        `clientmove clid=${client.clientID()} cid=${cid}`,
      );
    },
    getServerInfo: async () => {
      try {
        const rows = await client.execCommandWithResponse("serverinfo");
        return rows[0] ?? {};
      } catch (error) {
        logger.error({ err: error, command: "serverinfo" }, "Failed to get server info");
        return {};
      }
    },
    getClientInfo: async (clid: number) => {
      try {
        const rows = await client.execCommandWithResponse(
          `clientinfo clid=${clid}`,
        );
        return rows[0] ?? {};
      } catch {
        return {};
      }
    },
    getChannelInfo: async (cid: number) => {
      try {
        const rows = await client.execCommandWithResponse(
          `channelinfo cid=${cid}`,
        );
        return rows[0] ?? {};
      } catch {
        return {};
      }
    },
    listClients: async () => {
      try {
        const entries = await listClients(client);
        return entries
          .filter((e) => e.type === 0)
          .map((e) => ({
            clid: e.id,
            name: e.nickname,
            uid: e.uid,
            cid: Number(e.channelID),
            ...(e.serverGroups.length > 0 ? { groups: e.serverGroups } : {}),
          }));
      } catch (error) {
        logger.error({ err: error }, "Failed to list clients via library");
        return [];
      }
    },
    getServerGroupPermissions: async (sgid: number) => {
      try {
        const rows = await client.execCommandWithResponse(
          `servergrouppermlist sgid=${sgid}`,
        );
        return rows.filter(
          (
            row,
          ): row is Record<string, string> & {
            permid: string;
            permvalue: string;
          } =>
            typeof row.permid === "string" && typeof row.permvalue === "string",
        );
      } catch {
        return [];
      }
    },
    onClientMoved: (handler) => {
      client.on("clientMoved", (event) => {
        handler({
          movedClid: event.id,
          targetCid: Number(event.targetChannelID),
          invokerName: event.invokerName,
          invokerUid: event.invokerUID,
          invokerClid: event.invokerID,
          self: event.id === client.clientID(),
        });
      });
    },
    onClientEnter: (handler) => {
      client.on("clientEnter", (info) => {
        if (info.type !== 0) return;
        handler({
          clid: info.id,
          name: info.nickname,
          uid: info.uid,
          groups: info.serverGroups,
          cid: Number(info.channelID),
        });
      });
    },
    onClientLeave: (handler) => {
      client.on("clientLeave", (info) => {
        if (info.id === client.clientID()) return;
        handler(info.id);
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
    sendChannelMessage: async (message) => {
      try {
        await withTimeout(
          client.execCommand(
            `sendtextmessage targetmode=2 target=${client.channelID()} msg=${escapeClientParam(message)}`,
          ),
          MESSAGE_SEND_TIMEOUT_MS,
          "Sending the channel message timed out",
        );
      } catch (error) {
        logger.error(
          { err: error, channelId: String(client.channelID()) },
          "Failed to send channel message",
        );
      }
    },
    sendPrivateMessage: async (clid, message) => {
      try {
        await withTimeout(
          client.execCommand(
            `sendtextmessage targetmode=1 target=${clid} msg=${escapeClientParam(message)}`,
          ),
          MESSAGE_SEND_TIMEOUT_MS,
          "Sending the private message timed out",
        );
      } catch (error) {
        logger.error(
          { err: error, targetClid: clid },
          "Failed to send private message",
        );
      }
    },
    sendVoiceFrame: (frame) => client.sendVoice(frame, 5),
    onTextMessage: (handler) => {
      client.on("textMessage", (message) =>
        handler(
          message.message,
          message.invokerUID,
          message.invokerName,
          message.invokerGroups,
          message.targetMode === 1,
          message.invokerID,
        ),
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
