import type { Ts3Connection } from "../adapters/ts3/ts3-connection.js";
import {
  ChannelDirectory,
  ServerSnapshot,
  pickChannels,
  type ServerView,
  type ServerViewMode,
} from "../application/server-snapshot.js";
import type { MinimalLogger } from "../observability/logger.js";

type ServerViewConnection = Pick<
  Ts3Connection,
  "getChannelInfo" | "listClients"
>;

/** Every tenth minute resync also runs the full channel discovery. */
const FULL_DISCOVERY_EVERY = 10;

/**
 * Keeps the panel's server view in sync with TeamSpeak. Voice clients cannot
 * run `channellist`, so the full tree (including empty channels) is
 * discovered by probing `channelinfo` per cid. A full scan costs ~4
 * commands/s against the shared flood budget, so it runs in the background
 * at startup, on reconnect and every tenth resync; the minute resync only
 * resolves the channels occupied clients sit in.
 */
export class ServerViewSync {
  readonly snapshot = new ServerSnapshot();
  readonly #directory: ChannelDirectory;
  readonly #connection: ServerViewConnection;
  readonly #logger: MinimalLogger;
  #mode: ServerViewMode = "partial";
  #discoveryInFlight = false;
  #ticks = 0;

  constructor(connection: ServerViewConnection, logger: MinimalLogger) {
    this.#connection = connection;
    this.#logger = logger;
    this.#directory = new ChannelDirectory(async (cid) => {
      try {
        const info = await connection.getChannelInfo(cid);
        const name = info["channel_name"];
        // A missing channel surfaces as an error (swallowed to {}) or an
        // empty row: without a name the cid does not exist, so report it as
        // unknown instead of caching a `#cid` phantom entry.
        if (name === undefined || name.length === 0) return undefined;
        // channellist uses `pid`, channelinfo uses `cpid`.
        const pid = Number(info["cpid"] ?? info["pid"] ?? Number.NaN);
        const order = Number(info["channel_order"] ?? Number.NaN);
        return {
          name,
          ...(Number.isSafeInteger(pid) && pid > 0 ? { parentCid: pid } : {}),
          ...(Number.isSafeInteger(order) ? { order } : {}),
        };
      } catch {
        return undefined;
      }
    });
  }

  get mode(): ServerViewMode {
    return this.#mode;
  }

  toJSON(): ServerView {
    return this.snapshot.toJSON();
  }

  /** Resolves a channel a client just entered or moved to. */
  async ensureChannel(cid: number): Promise<void> {
    await this.#directory.resolve(cid);
    this.snapshot.setChannels(this.#directory.snapshot());
  }

  async resync(options: { full?: boolean } = {}): Promise<void> {
    try {
      if (options.full) await this.#discover();
      const clients = await this.#connection.listClients();
      // Map explicitly: uids and groups must never reach the panel payload.
      const mapped = clients.map((client) => ({
        clid: client.clid,
        name: client.name,
        cid: client.cid,
      }));
      const cids = [...new Set(mapped.map((client) => client.cid))];
      const visible = await Promise.all(
        cids.map((cid) => this.#directory.resolve(cid)),
      );
      const picked = pickChannels(this.#directory.snapshot(), visible);
      this.#mode = picked.mode;
      this.snapshot.fullResync(picked.channels, mapped);
    } catch (error) {
      this.#logger.debug({ err: error }, "Server view resync failed");
    }
  }

  /** The minute resync. */
  tick(): Promise<void> {
    this.#ticks++;
    return this.resync({ full: this.#ticks % FULL_DISCOVERY_EVERY === 0 });
  }

  async #discover(): Promise<void> {
    if (this.#discoveryInFlight) return;
    this.#discoveryInFlight = true;
    try {
      // TS3 allocates cids increasingly, so max+margin catches new channels.
      const ceiling = Math.min(
        1024,
        Math.max(192, this.#directory.maxCid() + 32),
      );
      const result = await this.#directory.discover({
        ceiling,
        concurrency: 4,
      });
      this.#logger.debug(
        { ceiling: result.ceiling, found: result.found },
        "TeamSpeak channel discovery finished",
      );
    } catch (error) {
      this.#logger.debug({ err: error }, "TeamSpeak channel discovery failed");
    } finally {
      this.#discoveryInFlight = false;
    }
  }
}
