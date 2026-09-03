export interface SnapshotChannel {
  readonly cid: number;
  readonly name: string;
  readonly parentCid?: number;
}

export interface SnapshotClient {
  readonly clid: number;
  readonly name: string;
  readonly cid: number;
}

export interface ServerView {
  readonly version: number;
  readonly channels: readonly SnapshotChannel[];
  readonly clients: readonly SnapshotClient[];
}

export type ChannelInfoFetcher = (
  cid: number,
) => Promise<{ name?: string; parentCid?: number } | undefined>;

/**
 * Resolves channel metadata without `channellist` (some servers restrict
 * that command to admins). Channels are discovered from the cids of visible
 * clients and enriched one by one via `channelinfo`, which regular clients
 * can usually call. Results are cached; unknown channels degrade to `#cid`.
 */
export class ChannelDirectory {
  readonly #cache = new Map<number, SnapshotChannel>();

  constructor(private readonly fetchInfo: ChannelInfoFetcher) {}

  async resolve(cid: number): Promise<SnapshotChannel> {
    const cached = this.#cache.get(cid);
    if (cached !== undefined) return cached;
    const fallback: SnapshotChannel = { cid, name: `#${cid}` };
    try {
      const info = await this.fetchInfo(cid);
      const name =
        info?.name !== undefined && info.name.length > 0
          ? info.name
          : fallback.name;
      const entry: SnapshotChannel =
        info?.parentCid !== undefined
          ? { cid, name, parentCid: info.parentCid }
          : { cid, name };
      this.#cache.set(cid, entry);
      return entry;
    } catch {
      this.#cache.set(cid, fallback);
      return fallback;
    }
  }

  snapshot(): readonly SnapshotChannel[] {
    return [...this.#cache.values()].sort((a, b) => a.cid - b.cid);
  }

  prime(entry: SnapshotChannel): void {
    if (Number.isSafeInteger(entry.cid) && entry.cid > 0) {
      this.#cache.set(entry.cid, { ...entry });
    }
  }

  clear(): void {
    this.#cache.clear();
  }
}

export type ServerViewMode = "full" | "partial";

/**
 * Picks the channel source: the full channellist when the server allows it,
 * otherwise the channels resolved from visible clients (occupied only).
 */
export function pickChannels(
  full: readonly SnapshotChannel[],
  visible: readonly SnapshotChannel[],
): { channels: readonly SnapshotChannel[]; mode: ServerViewMode } {
  if (full.length > 0) return { channels: full, mode: "full" };
  return { channels: visible, mode: "partial" };
}

/**
 * In-memory mirror of the TeamSpeak server structure for the panel's live
 * server view. Seeded with a full channellist/clientlist, then patched
 * incrementally from clientEnter/clientMoved/clientLeave events. A periodic
 * full resync heals anything the events miss (channel create/delete/rename).
 */
export class ServerSnapshot {
  readonly #channels = new Map<number, SnapshotChannel>();
  readonly #clients = new Map<number, SnapshotClient>();
  #version = 0;

  get version(): number {
    return this.#version;
  }

  fullResync(
    channels: readonly SnapshotChannel[],
    clients: readonly SnapshotClient[],
  ): void {
    this.#channels.clear();
    for (const channel of channels) {
      if (Number.isSafeInteger(channel.cid) && channel.cid > 0) {
        this.#channels.set(channel.cid, { ...channel });
      }
    }
    this.#clients.clear();
    for (const client of clients) {
      if (Number.isSafeInteger(client.clid) && client.clid >= 0) {
        this.#clients.set(client.clid, { ...client });
      }
    }
    this.#version++;
  }

  applyEnter(client: SnapshotClient): void {
    if (!Number.isSafeInteger(client.clid) || client.clid < 0) return;
    this.#clients.set(client.clid, { ...client });
    this.#version++;
  }

  applyMove(clid: number, targetCid: number): void {
    const existing = this.#clients.get(clid);
    if (existing === undefined) return;
    this.#clients.set(clid, { ...existing, cid: targetCid });
    this.#version++;
  }

  applyLeave(clid: number): void {
    if (this.#clients.delete(clid)) this.#version++;
  }

  setChannels(channels: readonly SnapshotChannel[]): void {
    this.#channels.clear();
    for (const channel of channels) {
      if (Number.isSafeInteger(channel.cid) && channel.cid > 0) {
        this.#channels.set(channel.cid, { ...channel });
      }
    }
    this.#version++;
  }

  toJSON(): ServerView {
    return {
      version: this.#version,
      channels: [...this.#channels.values()].sort((a, b) => a.cid - b.cid),
      clients: [...this.#clients.values()].sort((a, b) => a.clid - b.clid),
    };
  }
}
