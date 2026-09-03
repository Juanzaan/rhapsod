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

  toJSON(): ServerView {
    return {
      version: this.#version,
      channels: [...this.#channels.values()].sort((a, b) => a.cid - b.cid),
      clients: [...this.#clients.values()].sort((a, b) => a.clid - b.clid),
    };
  }
}
