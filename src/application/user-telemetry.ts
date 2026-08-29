import type { Logger } from "pino";

import { readJsonFile, writeJsonFile } from "../lib/json-file-store.js";

export interface UserTelemetryEntry {
  readonly uid: string;
  readonly names: string[];
  readonly serverGroupIds: string[];
  maxTalkPower: number;
  firstSeenAt: number;
  lastSeenAt: number;
  lastSeenChannelId?: number;
  commandCount: number;
  botMovedBy: number;
  botChannelEntries: number;
}

interface TelemetryFile {
  readonly version: 1;
  readonly users: Record<string, UserTelemetryEntry>;
}

function parseEntry(raw: unknown): UserTelemetryEntry | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  if (typeof record.uid !== "string" || record.uid.length === 0)
    return undefined;
  const entry: UserTelemetryEntry = {
    uid: record.uid,
    names: Array.isArray(record.names)
      ? record.names.filter((name): name is string => typeof name === "string")
      : [],
    serverGroupIds: Array.isArray(record.serverGroupIds)
      ? record.serverGroupIds.filter(
          (gid): gid is string => typeof gid === "string",
        )
      : [],
    maxTalkPower: finiteNumber(record.maxTalkPower, 0),
    firstSeenAt: finiteNumber(record.firstSeenAt, Date.now()),
    lastSeenAt: finiteNumber(record.lastSeenAt, Date.now()),
    commandCount: nonNegativeInt(record.commandCount),
    botMovedBy: nonNegativeInt(record.botMovedBy),
    botChannelEntries: nonNegativeInt(record.botChannelEntries),
  };
  const lastSeenChannelId = finiteNumber(record.lastSeenChannelId, NaN);
  if (Number.isFinite(lastSeenChannelId))
    entry.lastSeenChannelId = lastSeenChannelId;
  return entry;
}

function finiteNumber(raw: unknown, fallback: number): number {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
}

function nonNegativeInt(raw: unknown): number {
  return typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0
    ? raw
    : 0;
}

export class UserTelemetry {
  private readonly users = new Map<string, UserTelemetryEntry>();
  private readonly clidToUid = new Map<number, string>();

  constructor(
    private readonly filePath: string,
    private readonly logger: Logger,
  ) {}

  load(): void {
    const file = readJsonFile(
      this.filePath,
      (raw): TelemetryFile | undefined => {
        if (typeof raw !== "object" || raw === null) return undefined;
        const record = raw as Record<string, unknown>;
        if (
          record.version !== 1 ||
          typeof record.users !== "object" ||
          record.users === null
        ) {
          return undefined;
        }
        return {
          version: 1,
          users: record.users as Record<string, unknown>,
        } as unknown as TelemetryFile;
      },
    );
    if (file === undefined) {
      this.logger.warn(
        { filePath: this.filePath },
        "Failed to load user telemetry; starting fresh",
      );
      return;
    }
    for (const entry of Object.values(file.users)) {
      const parsed = parseEntry(entry);
      if (parsed !== undefined) this.users.set(parsed.uid, parsed);
    }
    this.logger.info(
      { loadedUsers: this.users.size, filePath: this.filePath },
      "User telemetry loaded",
    );
  }

  resetClients(): void {
    this.clidToUid.clear();
  }

  clientEntered(args: {
    readonly clid: number;
    readonly uid: string;
    readonly name: string;
    readonly groupIds: readonly string[];
    readonly talkPower?: number;
    readonly channelId: number;
  }): void {
    this.clidToUid.set(args.clid, args.uid);
    this.recordPresence(
      args.uid,
      args.name,
      args.groupIds,
      args.talkPower,
      args.channelId,
    );
  }

  clientLeft(clid: number): void {
    const uid = this.clidToUid.get(clid);
    if (!uid) return;
    this.clidToUid.delete(clid);
    const entry = this.users.get(uid);
    if (entry) entry.lastSeenAt = Date.now();
  }

  recordPresence(
    uid: string,
    name: string,
    groupIds: readonly string[],
    talkPower: number | undefined,
    channelId: number,
  ): void {
    const now = Date.now();
    let entry = this.users.get(uid);
    if (!entry) {
      entry = {
        uid,
        names: [],
        serverGroupIds: [],
        maxTalkPower: 0,
        firstSeenAt: now,
        lastSeenAt: now,
        commandCount: 0,
        botMovedBy: 0,
        botChannelEntries: 0,
      };
      this.users.set(uid, entry);
    }
    if (!entry.names.includes(name)) entry.names.push(name);
    for (const gid of groupIds) {
      if (!entry.serverGroupIds.includes(gid)) entry.serverGroupIds.push(gid);
    }
    if (talkPower !== undefined && talkPower > entry.maxTalkPower) {
      entry.maxTalkPower = talkPower;
    }
    entry.lastSeenAt = now;
    entry.lastSeenChannelId = channelId;
  }

  recordCommand(uid: string): void {
    const entry = this.users.get(uid);
    if (entry) entry.commandCount += 1;
  }

  recordBotMovedBy(uid: string): void {
    const entry = this.users.get(uid);
    if (entry) entry.botMovedBy += 1;
  }

  recordBotChannelEntry(uid: string): void {
    const entry = this.users.get(uid);
    if (entry) entry.botChannelEntries += 1;
  }

  snapshot(): readonly UserTelemetryEntry[] {
    return [...this.users.values()].sort(
      (a, b) => b.maxTalkPower - a.maxTalkPower,
    );
  }

  async save(): Promise<void> {
    try {
      const data: TelemetryFile = {
        version: 1,
        users: Object.fromEntries(this.users),
      };
      await writeJsonFile(this.filePath, data);
    } catch (error) {
      this.logger.error({ err: error }, "Failed to save user telemetry");
    }
  }

  logSummary(reason: string): void {
    const top = this.snapshot().slice(0, 30);
    this.logger.info(
      {
        reason,
        trackedUsers: this.users.size,
        topUsers: top.map((u) => ({
          name: u.names[u.names.length - 1] ?? "?",
          groups: u.serverGroupIds,
          talk: u.maxTalkPower,
          commands: u.commandCount,
          movedBot: u.botMovedBy,
          botChannel: u.botChannelEntries,
          firstSeenAt: u.firstSeenAt,
          lastSeenAt: u.lastSeenAt,
        })),
      },
      "User telemetry summary",
    );
  }
}
