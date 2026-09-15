import { dirname } from "node:path";
import { mkdir, rename, writeFile } from "node:fs/promises";

import type { MinimalLogger } from "../observability/logger.js";
import { noopLogger } from "../observability/logger.js";
import { readJsonFile } from "../lib/json-file-store.js";

export interface LibraryTrackInput {
  readonly artist?: string;
  readonly id: string;
  readonly source?: string;
  readonly title: string;
}

export interface LibraryEntry {
  readonly artist?: string;
  readonly firstHeardAt: number;
  readonly lastHeardAt: number;
  readonly plays: number;
  readonly source?: string;
  readonly title: string;
}

interface StoredEntry {
  artist?: string;
  firstHeardAt: number;
  lastHeardAt: number;
  plays: number;
  source?: string;
  title: string;
}

function parseEntry(raw: unknown): StoredEntry | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  if (typeof record.title !== "string" || record.title.length === 0) {
    return undefined;
  }
  const at = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) ? value : Date.now();
  const plays =
    typeof record.plays === "number" &&
    Number.isSafeInteger(record.plays) &&
    record.plays > 0
      ? record.plays
      : 1;
  return {
    ...(typeof record.artist === "string" && record.artist.length > 0
      ? { artist: record.artist }
      : {}),
    firstHeardAt: at(record.firstHeardAt),
    lastHeardAt: at(record.lastHeardAt),
    plays,
    ...(typeof record.source === "string" && record.source.length > 0
      ? { source: record.source }
      : {}),
    title: record.title,
  };
}

function parseLibraryFile(raw: unknown): Map<string, StoredEntry> | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as { tracks?: unknown; version?: unknown };
  if (record.version !== 1) return undefined;
  const tracks = new Map<string, StoredEntry>();
  if (typeof record.tracks === "object" && record.tracks !== null) {
    for (const [id, entry] of Object.entries(
      record.tracks as Record<string, unknown>,
    )) {
      if (id.length === 0) continue;
      const parsed = parseEntry(entry);
      if (parsed !== undefined) tracks.set(id, parsed);
    }
  }
  return tracks;
}

// Permanent catalog of every song the bot has played or identified on the
// radio. Unlike the listening history (taste signals with decay and caps),
// this never prunes: entries are deduplicated by id and only grow plays and
// lastHeardAt. It is the archive global autoplay and library views read
// from; history remains the per-user taste store.
export class SongLibrary {
  readonly #filePath: string;
  readonly #logger: MinimalLogger;
  readonly #tracks = new Map<string, StoredEntry>();
  #loaded = false;
  #writeChain: Promise<void> = Promise.resolve();

  constructor(filePath: string, logger?: MinimalLogger) {
    this.#filePath = filePath;
    this.#logger = logger ?? noopLogger;
  }

  record(input: LibraryTrackInput): void {
    this.#ensureLoaded();
    const now = Date.now();
    const entry = this.#tracks.get(input.id);
    if (entry === undefined) {
      this.#tracks.set(input.id, {
        ...(input.artist === undefined ? {} : { artist: input.artist }),
        firstHeardAt: now,
        lastHeardAt: now,
        plays: 1,
        ...(input.source === undefined ? {} : { source: input.source }),
        title: input.title,
      });
    } else {
      entry.plays++;
      entry.lastHeardAt = now;
    }
    void this.#schedulePersist();
  }

  size(): number {
    this.#ensureLoaded();
    return this.#tracks.size;
  }

  get(id: string): LibraryEntry | undefined {
    this.#ensureLoaded();
    const entry = this.#tracks.get(id);
    return entry === undefined ? undefined : { ...entry };
  }

  recent(limit: number): readonly LibraryEntry[] {
    this.#ensureLoaded();
    return [...this.#tracks.values()]
      .sort((a, b) => b.lastHeardAt - a.lastHeardAt)
      .slice(0, Math.max(1, limit))
      .map((entry) => ({ ...entry }));
  }

  async flush(): Promise<void> {
    await this.#writeChain;
  }

  #ensureLoaded(): void {
    if (this.#loaded) return;
    this.#loaded = true;
    const parsed = readJsonFile(this.#filePath, parseLibraryFile);
    if (parsed === undefined) return;
    for (const [id, entry] of parsed) this.#tracks.set(id, entry);
  }

  #schedulePersist(): Promise<void> {
    const write = this.#writeChain.then(() => this.#persistNow());
    this.#writeChain = write.catch(() => undefined);
    return write;
  }

  async #persistNow(): Promise<void> {
    try {
      await mkdir(dirname(this.#filePath), { recursive: true });
      const temporary = `${this.#filePath}.tmp`;
      await writeFile(
        temporary,
        JSON.stringify({
          tracks: Object.fromEntries(this.#tracks),
          version: 1 as const,
        }),
        { encoding: "utf8", mode: 0o600 },
      );
      await rename(temporary, this.#filePath);
    } catch (error) {
      this.#logger.warn(
        { err: error },
        "SongLibrary: failed to persist song library",
      );
    }
  }
}
