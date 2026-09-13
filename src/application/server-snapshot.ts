export interface SnapshotChannel {
  readonly cid: number;
  readonly name: string;
  readonly parentCid?: number;
  readonly order?: number;
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
) => Promise<{ name?: string; parentCid?: number; order?: number } | undefined>;

/**
 * Resolves channel metadata without `channellist` (voice clients cannot run
 * it: the server answers `command not found`). Channels are discovered by
 * probing `channelinfo` per cid, which works for any channel the bot may
 * see - including empty ones no client currently occupies. Results are
 * cached; unknown channels degrade to `#cid`.
 */
export class ChannelDirectory {
  readonly #cache = new Map<number, SnapshotChannel>();

  constructor(private readonly fetchInfo: ChannelInfoFetcher) {}

  /**
   * Probes every cid from 1 to `ceiling` with bounded concurrency and
   * replaces the cached entries in that range with what the server reports.
   * Cached entries above the ceiling are kept. When the scan finds nothing
   * (e.g. a dropped connection mid-scan) the cache is left untouched so a
   * transient failure cannot wipe the whole tree.
   */
  async discover(
    options: { ceiling?: number; concurrency?: number } = {},
  ): Promise<{ found: number; ceiling: number }> {
    const ceiling = Math.max(1, Math.floor(options.ceiling ?? 192));
    const concurrency = Math.max(
      1,
      Math.min(16, Math.floor(options.concurrency ?? 4)),
    );
    const missing = new Set<number>();
    let found = 0;
    let next = 1;
    const workers = Array.from(
      { length: Math.min(concurrency, ceiling) },
      async () => {
        while (next <= ceiling) {
          const cid = next++;
          let info: Awaited<ReturnType<ChannelInfoFetcher>>;
          try {
            info = await this.fetchInfo(cid);
          } catch {
            missing.add(cid);
            continue;
          }
          // A channel without a name does not exist: the fetcher reports
          // unknown cids as undefined or an empty row, and neither may
          // become a `#cid` phantom entry in the tree.
          if (
            info === undefined ||
            info.name === undefined ||
            info.name.length === 0
          ) {
            missing.add(cid);
            continue;
          }
          const name = info.name;
          this.#cache.set(cid, {
            cid,
            name,
            ...(info.parentCid !== undefined
              ? { parentCid: info.parentCid }
              : {}),
            ...(info.order !== undefined ? { order: info.order } : {}),
          });
          found++;
        }
      },
    );
    await Promise.all(workers);
    if (found === 0) return { ceiling, found: 0 };
    for (const cid of missing) this.#cache.delete(cid);
    return { ceiling, found };
  }

  maxCid(): number {
    let max = 0;
    for (const cid of this.#cache.keys()) {
      if (cid > max) max = cid;
    }
    return max;
  }

  async resolve(cid: number): Promise<SnapshotChannel> {
    const cached = this.#cache.get(cid);
    if (cached !== undefined) return cached;
    const fallback: SnapshotChannel = { cid, name: `#${cid}` };
    // Failures stay uncached: a transient `channelinfo` error must not pin
    // a `#cid` entry, or the real name would never load on retry.
    let info: Awaited<ReturnType<ChannelInfoFetcher>>;
    try {
      info = await this.fetchInfo(cid);
    } catch {
      return fallback;
    }
    if (info === undefined) return fallback;
    const name =
      info.name !== undefined && info.name.length > 0
        ? info.name
        : fallback.name;
    const entry: SnapshotChannel = {
      cid,
      name,
      ...(info.parentCid !== undefined ? { parentCid: info.parentCid } : {}),
      ...(info.order !== undefined ? { order: info.order } : {}),
    };
    this.#cache.set(cid, entry);
    return entry;
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
 * Picks the channel source: the discovered directory when it holds entries,
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
