import {
  Client,
  listClients,
  listChannels,
  type Identity,
} from "@honeybbq/teamspeak-client";

import type { Logger } from "pino";

import type { AppConfig } from "../../config.js";

const MESSAGE_SEND_TIMEOUT_MS = 10_000;
const MESSAGE_RATE_INTERVAL_MS = 1_100;
const MESSAGE_QUEUE_MAX = 50;
// TeamSpeak rejects text messages longer than 1024 characters.
export const MAX_TEXT_MESSAGE_LENGTH = 1024;
const HEARTBEAT_PROBE_TIMEOUT_MS = 15_000;
// A healthy handshake takes well under a second. The client library drops
// login errors (see watchLoginErrors) and then waits forever; on
// 2026-09-30 two deploys hung 180 s after "received initivexpand2" while a
// fresh process connected in 0.3 s. So each handshake gets a short budget
// and a clean retry within RHAPSOD_TS3_CONNECT_TIMEOUT_SECONDS.
export const HANDSHAKE_ATTEMPT_MS = 10_000;
// Spaced out because a flood-prevention ban (error 3329) is one of the
// ways a handshake ends, and hammering the server keeps the ban alive.
export const HANDSHAKE_RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 20_000, 30_000];

/**
 * Exit code for a refused duplicate start. The systemd unit lists it in
 * `RestartPreventExitStatus` so a second instance exits instead of
 * flap-restarting a duplicate onto the server every few seconds.
 */
export const DUPLICATE_INSTANCE_EXIT_CODE = 42;

export class DuplicateBotInstanceError extends Error {
  constructor(nickname: string) {
    super(
      `Another bot with this identity or nickname ("${nickname}") is already ` +
        `connected; refusing to join as a duplicate. Stop the other instance ` +
        `first — or, if none is running, wait a minute for its ghost to time ` +
        `out and start again.`,
    );
    this.name = "DuplicateBotInstanceError";
  }
}

/**
 * Serializes outgoing text messages at one per interval, in call order.
 * Messages run on a single chain: each part waits for the previous send to
 * finish and for its interval, so a burst goes out evenly spaced instead of
 * waking together (0, 1101, 1101, 1101...), and the parts of a split message
 * go out back to back: another message queued meanwhile can no longer land
 * between part 1 and part 2.
 */
export function createMessageGate(options: {
  readonly intervalMs?: number;
  readonly maxQueue?: number;
  readonly onDrop?: (queued: number) => void;
  readonly now?: () => number;
}) {
  const intervalMs = options.intervalMs ?? MESSAGE_RATE_INTERVAL_MS;
  const maxQueue = options.maxQueue ?? MESSAGE_QUEUE_MAX;
  const now = options.now ?? Date.now;
  let lastSendAt = Number.NEGATIVE_INFINITY;
  let queued = 0;
  let tail: Promise<void> = Promise.resolve();
  return (sends: ReadonlyArray<() => Promise<void>>): Promise<void> => {
    if (queued + sends.length > maxQueue) {
      // Drop the whole message instead of piling up against the anti-flood.
      options.onDrop?.(queued);
      return Promise.resolve();
    }
    queued += sends.length;
    const run = async (): Promise<void> => {
      let remaining = sends.length;
      try {
        for (const send of sends) {
          const waitMs = lastSendAt + intervalMs - now();
          if (waitMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, waitMs));
          }
          queued--;
          remaining--;
          lastSendAt = now();
          await send();
        }
      } finally {
        queued -= remaining;
      }
    };
    const result = tail.then(run);
    tail = result.catch(() => undefined);
    return result;
  };
}

/**
 * Splits text into parts TeamSpeak accepts, preferring line breaks, then
 * spaces, and cutting mid-word only when a single word is too long. Lengths
 * count code points, so an emoji is never cut in half.
 */
export function splitTextMessage(
  text: string,
  maxLength = MAX_TEXT_MESSAGE_LENGTH,
): string[] {
  const parts: string[] = [];
  let rest = [...text];
  while (rest.length > maxLength) {
    const window = rest.slice(0, maxLength + 1);
    let cut = window.lastIndexOf("\n");
    if (cut <= 0) cut = window.lastIndexOf(" ");
    if (cut <= 0) cut = maxLength;
    parts.push(rest.slice(0, cut).join(""));
    rest = rest.slice(cut);
    // Drop the separator the cut landed on.
    if (rest[0] === "\n" || rest[0] === " ") rest = rest.slice(1);
  }
  if (rest.length > 0 || parts.length === 0) parts.push(rest.join(""));
  return parts;
}

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

export interface Ts3Connection {
  /**
   * Connects to the server. Unless `skipDuplicateCheck` is set, refuses to
   * stay connected when this bot's identity or nickname is already online
   * (see `DuplicateBotInstanceError`). Reconnects must skip the check: our
   * own ghost can linger on the server right after a dropped connection,
   * and failing there would keep a live bot down.
   */
  connect(options?: { skipDuplicateCheck?: boolean }): Promise<void>;
  disconnect(): Promise<void>;
  listChannels(): Promise<
    readonly { cid: number; name: string; parentCid?: number; order?: number }[]
  >;
  getCurrentChannel(): Promise<{
    readonly cid: number;
    readonly name?: string;
  }>;
  getCurrentChannelId(): number;
  listConnectedClientUids(): Promise<readonly string[]>;
  /**
   * UIDs of the people listening with the bot: regular clients in the bot's
   * current channel, without the bot itself or query clients, one entry per
   * identity. `undefined` when the list cannot be read, so callers can tell
   * a failed query from an empty channel.
   */
  listChannelListenerUids(): Promise<readonly string[] | undefined>;
  canTalkInCurrentChannel(): Promise<boolean>;
  moveToChannel(cid: number): Promise<void>;
  /**
   * Renames the bot on the live server and keeps the new name for later
   * reconnects. Rejects when the server refuses it (name taken, too long).
   */
  setNickname(nickname: string): Promise<void>;
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
  probeTimeoutMs = Math.min(intervalMs, HEARTBEAT_PROBE_TIMEOUT_MS),
): () => void {
  let consecutiveFailures = 0;
  let probing = false;
  const timer = setInterval(() => {
    // A probe that never settles used to count as neither success nor
    // failure, so a silently dead connection was never detected. Bound it,
    // and never stack probes on top of a slow one.
    if (probing) return;
    probing = true;
    void withTimeout(probe(), probeTimeoutMs, "Heartbeat probe timed out")
      .then(() => {
        consecutiveFailures = 0;
      })
      .catch(() => {
        consecutiveFailures++;
        if (consecutiveFailures >= requiredFailures) {
          consecutiveFailures = 0;
          onLost();
        }
      })
      .finally(() => {
        probing = false;
      });
  }, intervalMs);
  return () => clearInterval(timer);
}

interface ClientListEntry {
  readonly id: number;
  readonly nickname: string;
  readonly uid: string;
}

/**
 * Refuses to stay connected when this bot is already online. Matches by
 * identity UID (same data dir started twice) or by configured nickname (a
 * second machine with its own identity, the classic staging-vs-production
 * accident). Runs before anything visible happens — no description set, no
 * channel move — so a rejected start leaves almost no footprint.
 *
 * Fail-open by design: if the client list cannot be read, or our own entry
 * is missing from it, the bot connects anyway with a warning. This is
 * duplicate prevention, not a security boundary, and must never brick the
 * bot on a permission-restricted server.
 */
export function rejectDuplicateInstance(
  entries: readonly ClientListEntry[],
  selfId: number,
  nickname: string,
): void {
  const self = entries.find((entry) => entry.id === selfId);
  if (self === undefined) return;
  const duplicate = entries.find(
    (entry) =>
      entry.id !== selfId &&
      (entry.uid === self.uid || entry.nickname === nickname),
  );
  if (duplicate !== undefined) {
    throw new DuplicateBotInstanceError(nickname);
  }
}

export interface LoginError {
  readonly id: string;
  readonly message: string;
}

/** Reads an `error` line with a non-zero id and no return code. */
export function parseLoginError(line: string): LoginError | undefined {
  if (!line.startsWith("error ")) return undefined;
  const params = new Map<string, string>();
  for (const part of line.slice("error ".length).split(" ")) {
    const eq = part.indexOf("=");
    if (eq > 0) params.set(part.slice(0, eq), part.slice(eq + 1));
  }
  const id = params.get("id");
  if (id === undefined || id === "0" || params.has("return_code")) {
    return undefined;
  }
  const message = [params.get("msg"), params.get("extra_msg")]
    .filter((text): text is string => text !== undefined && text !== "")
    .map(unescapeParam)
    .join(": ");
  return { id, message: message === "" ? "unknown error" : message };
}

function unescapeParam(value: string): string {
  return value.replace(/\\(.)/g, (_match, code: string) => {
    switch (code) {
      case "s":
        return " ";
      case "p":
        return "|";
      case "n":
        return "\n";
      case "t":
        return "\t";
      default:
        return code;
    }
  });
}

interface LoginPacketTap {
  handler?: { onPacket?: ((packet: LoginPacket) => void) | null };
}

interface LoginPacket {
  typeFlagged: number;
  data: Uint8Array;
}

const COMMAND_PACKET = 2;

/**
 * The library answers an error without a return code (every login error:
 * 521 "too many clones", a wrong server password, ...) by dropping it, so
 * the handshake waits forever. This reads the commands its packet handler
 * delivers, through fields the library marks internal: it must be called
 * right after client.connect() starts, which builds a fresh handler, and
 * it does nothing if that shape ever changes.
 */
export function watchLoginErrors(
  client: unknown,
  onError: (error: LoginError) => void,
): void {
  const handler = (client as LoginPacketTap).handler;
  const deliver = handler?.onPacket;
  if (handler === undefined || typeof deliver !== "function") return;
  handler.onPacket = (packet) => {
    if ((packet.typeFlagged & 15) === COMMAND_PACKET) {
      for (const line of Buffer.from(packet.data)
        .toString("utf8")
        .split(/[\n\0]/)) {
        const error = parseLoginError(line.trim());
        if (error !== undefined) onError(error);
      }
    }
    deliver(packet);
  };
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
  const messageGate = createMessageGate({
    onDrop: (queued) => {
      logger.warn(
        { queued },
        "Text message dropped: outgoing queue is full (anti-flood)",
      );
    },
  });
  // The client library has no `off()`, so kicked/disconnected are bound once
  // and fanned out; an unsubscribe removes its handler here instead of
  // leaving a listener that keeps firing into a stale reconnect loop.
  const connectionLostHandlers = new Set<
    (reason: "kicked" | "disconnected") => void
  >();
  let connectionLostBound = false;
  // Set only while a handshake waits. The library emits "disconnected"
  // when the server bans the login (3329) and drops every other login
  // error, and in neither case does waitConnected() settle; this ends the
  // attempt instead.
  let handshakeFailed: ((error: Error) => void) | undefined;
  let handshakeBound = false;
  const bindHandshakeClosed = (): void => {
    if (handshakeBound) return;
    handshakeBound = true;
    client.on("disconnected", () =>
      handshakeFailed?.(
        new Error("TeamSpeak server closed the connection during login"),
      ),
    );
  };
  // disconnect() bumps it so a connect that a caller gave up on (the
  // reconnect loop's attempt timeout) stops retrying behind its back.
  let connectEpoch = 0;
  const handshake = async (budgetMs: number): Promise<void> => {
    bindHandshakeClosed();
    const started = client.connect();
    watchLoginErrors(client, (error) => {
      if (handshakeFailed === undefined) return;
      logger.warn(
        { errorId: error.id, errorMessage: error.message },
        "TeamSpeak server refused the login",
      );
      handshakeFailed?.(
        new Error(
          `TeamSpeak server refused the login: ${error.message} (id=${error.id})`,
        ),
      );
    });
    await started;
    try {
      await new Promise<void>((resolve, reject) => {
        handshakeFailed = reject;
        withTimeout(
          client.waitConnected(),
          budgetMs,
          `TeamSpeak login did not finish in ${Math.round(budgetMs / 1_000)} s`,
        ).then(resolve, reject);
      });
    } finally {
      handshakeFailed = undefined;
    }
  };
  const connectWithRetry = async (): Promise<void> => {
    const epoch = connectEpoch;
    const deadline =
      Date.now() + config.RHAPSOD_TS3_CONNECT_TIMEOUT_SECONDS * 1_000;
    for (let attempt = 1; ; attempt++) {
      try {
        await handshake(
          Math.min(HANDSHAKE_ATTEMPT_MS, Math.max(deadline - Date.now(), 1)),
        );
        return;
      } catch (error) {
        await client.disconnect().catch(() => undefined);
        const delayMs =
          HANDSHAKE_RETRY_DELAYS_MS[
            Math.min(attempt, HANDSHAKE_RETRY_DELAYS_MS.length) - 1
          ] ?? 0;
        if (
          epoch !== connectEpoch ||
          Date.now() + delayMs + 1_000 >= deadline
        ) {
          throw error;
        }
        logger.warn(
          {
            attempt,
            retryInSeconds: delayMs / 1_000,
            errorMessage:
              error instanceof Error ? error.message : String(error),
          },
          "TeamSpeak login failed; retrying",
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        if (epoch !== connectEpoch) throw error;
      }
    }
  };
  const bindConnectionLost = (): void => {
    if (connectionLostBound) return;
    connectionLostBound = true;
    const notify = (reason: "kicked" | "disconnected"): void => {
      for (const handler of [...connectionLostHandlers]) handler(reason);
    };
    client.on("kicked", () => notify("kicked"));
    client.on("disconnected", () => notify("disconnected"));
  };

  return {
    connect: async (options?: { skipDuplicateCheck?: boolean }) => {
      await connectWithRetry();
      if (!options?.skipDuplicateCheck) {
        let entries;
        try {
          entries = await listClients(client);
        } catch (error) {
          logger.warn(
            {
              errorMessage:
                error instanceof Error ? error.message : String(error),
            },
            "Could not list clients to check for a duplicate bot instance; connecting anyway",
          );
          entries = undefined;
        }
        if (entries !== undefined) {
          try {
            rejectDuplicateInstance(
              entries,
              client.clientID(),
              config.RHAPSOD_TS3_NICKNAME,
            );
          } catch (error) {
            if (error instanceof DuplicateBotInstanceError) {
              logger.error(
                { nickname: config.RHAPSOD_TS3_NICKNAME },
                "Duplicate bot instance detected; disconnecting",
              );
            }
            await client.disconnect().catch(() => undefined);
            throw error;
          }
        }
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
    disconnect: () => {
      connectEpoch++;
      return client.disconnect();
    },
    listChannels: async () => {
      const parentOf = (pid: bigint | undefined): number | undefined => {
        if (pid === undefined) return undefined;
        const parentCid = Number(pid);
        return Number.isSafeInteger(parentCid) && parentCid > 0
          ? parentCid
          : undefined;
      };
      try {
        const entries = await listChannels(client);
        return entries.map((e) => {
          const parentCid = parentOf(
            typeof e.parentID === "bigint" ? e.parentID : undefined,
          );
          return parentCid === undefined
            ? { cid: Number(e.id), name: e.name }
            : { cid: Number(e.id), name: e.name, parentCid };
        });
      } catch (error) {
        logger.debug({ err: error }, "listChannels failed, using raw command");
        try {
          const rows = await client.execCommandWithResponse("channellist");
          return rows.flatMap((row) => {
            const cid = Number(row.cid);
            const name = row.channel_name ?? row.name;
            if (
              !Number.isSafeInteger(cid) ||
              cid <= 0 ||
              typeof name !== "string"
            )
              return [];
            const pid = Number(row.pid);
            const order = Number(row.channel_order ?? Number.NaN);
            return [
              {
                cid,
                name,
                ...(Number.isSafeInteger(pid) && pid > 0
                  ? { parentCid: pid }
                  : {}),
                ...(Number.isSafeInteger(order) && order >= 0 ? { order } : {}),
              },
            ];
          });
        } catch {
          return [];
        }
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
    listChannelListenerUids: async () => {
      try {
        const clients = await listClients(client);
        const channelId = client.channelID();
        const selfId = client.clientID();
        const uids = clients
          .filter(
            (entry) =>
              entry.type === 0 &&
              entry.id !== selfId &&
              entry.channelID === channelId,
          )
          .map((entry) => entry.uid);
        return [...new Set(uids)];
      } catch {
        return undefined;
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
    setNickname: async (nickname: string) => {
      await client.execCommand(
        `clientupdate client_nickname=${escapeClientParam(nickname)}`,
      );
      // The library sends this name in clientinit and matches it to find its
      // own clid, so a reconnect would otherwise come back with the old name.
      client.nickname = nickname;
    },
    getServerInfo: async () => {
      try {
        const rows = await client.execCommandWithResponse("serverinfo");
        return rows[0] ?? {};
      } catch (error) {
        logger.debug({ err: error }, "serverinfo not supported by this server");
        return {
          virtualserver_name: "(no disponible)",
          virtualserver_version: "?",
          virtualserver_maxclients: "?",
        };
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
      bindConnectionLost();
      connectionLostHandlers.add(handler);
      const heartbeatSeconds = config.RHAPSOD_TS3_HEARTBEAT_SECONDS;
      const stopHeartbeat =
        heartbeatSeconds > 0
          ? createHeartbeat(
              () => listClients(client).then(() => undefined),
              heartbeatSeconds * 1_000,
              () => handler("disconnected"),
            )
          : () => undefined;
      return () => {
        connectionLostHandlers.delete(handler);
        stopHeartbeat();
      };
    },
    sendChannelMessage: async (text) => {
      await messageGate(
        splitTextMessage(text).map((message) => async () => {
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
        }),
      );
    },
    sendPrivateMessage: async (clid, text) => {
      await messageGate(
        splitTextMessage(text).map((message) => async () => {
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
        }),
      );
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
