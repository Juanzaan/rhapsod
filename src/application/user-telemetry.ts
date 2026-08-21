import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { Logger } from "pino";

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

export class UserTelemetry {
  private readonly users = new Map<string, UserTelemetryEntry>();
  private readonly clidToUid = new Map<number, string>();

  constructor(
    private readonly filePath: string,
    private readonly logger: Logger,
  ) {}

  load(): void {
    try {
      const raw = JSON.parse(
        readFileSync(this.filePath, "utf8"),
      ) as Partial<TelemetryFile>;
      const users = raw.users ?? {};
      for (const entry of Object.values(users)) {
        if (entry?.uid) this.users.set(entry.uid, entry);
      }
      this.logger.info(
        { loadedUsers: this.users.size, filePath: this.filePath },
        "User telemetry loaded",
      );
    } catch (error) {
      this.logger.warn(
        { err: error },
        "Failed to load user telemetry; starting fresh",
      );
    }
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
      await mkdir(dirname(this.filePath), { recursive: true });
      const data: TelemetryFile = {
        version: 1,
        users: Object.fromEntries(this.users),
      };
      await writeFile(this.filePath, JSON.stringify(data, null, 2), "utf8");
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
