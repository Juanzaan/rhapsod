import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { LoopMode } from "../application/youtube-playback-service.js";

export interface SerializedQueueTrack {
  readonly durationSeconds?: number;
  readonly id: string;
  readonly requestedBy: string;
  readonly requestedByUid?: string;
  readonly searchQuery?: string;
  readonly source: string;
  readonly title: string;
}

export interface PlaybackState {
  readonly loopMode?: LoopMode;
  readonly queue?: readonly SerializedQueueTrack[];
  readonly volumePercent?: number;
}

export interface PlaybackStateStore {
  load(): PlaybackState;
  save(state: PlaybackState): void;
  flush(): Promise<void>;
}

const MAX_QUEUE_ENTRIES = 1000;
const SAVE_DEBOUNCE_MS = 1_000;

function parseQueue(raw: unknown): readonly SerializedQueueTrack[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const entries: SerializedQueueTrack[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    if (
      typeof record.id !== "string" ||
      record.id.length === 0 ||
      typeof record.title !== "string" ||
      record.title.length === 0 ||
      typeof record.source !== "string" ||
      record.source.length === 0 ||
      typeof record.requestedBy !== "string" ||
      record.requestedBy.length === 0
    ) {
      continue;
    }
    const durationSeconds =
      typeof record.durationSeconds === "number" &&
      Number.isFinite(record.durationSeconds) &&
      record.durationSeconds > 0
        ? Math.round(record.durationSeconds)
        : undefined;
    const requestedByUid =
      typeof record.requestedByUid === "string" &&
      record.requestedByUid.length > 0
        ? record.requestedByUid
        : undefined;
    const searchQuery =
      typeof record.searchQuery === "string" && record.searchQuery.length > 0
        ? record.searchQuery
        : undefined;
    entries.push({
      ...(durationSeconds === undefined ? {} : { durationSeconds }),
      id: record.id,
      requestedBy: record.requestedBy,
      ...(requestedByUid === undefined ? {} : { requestedByUid }),
      ...(searchQuery === undefined ? {} : { searchQuery }),
      source: record.source,
      title: record.title,
    });
    if (entries.length >= MAX_QUEUE_ENTRIES) break;
  }
  return entries;
}

export class FilePlaybackStateStore implements PlaybackStateStore {
  #pending: PlaybackState | undefined;
  #flushTimer: NodeJS.Timeout | undefined;
  #writeChain: Promise<void> = Promise.resolve();
  #directoryChecked = false;

  constructor(private readonly filePath: string) {}

  load(): PlaybackState {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf8");
    } catch {
      return {};
    }
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const volumePercent =
        typeof parsed.volumePercent === "number" &&
        Number.isFinite(parsed.volumePercent) &&
        parsed.volumePercent >= 0 &&
        parsed.volumePercent <= 100
          ? Math.round(parsed.volumePercent)
          : undefined;
      const loopMode =
        parsed.loopMode === "off" ||
        parsed.loopMode === "queue" ||
        parsed.loopMode === "track"
          ? parsed.loopMode
          : undefined;
      const queue = parseQueue(parsed.queue);
      return {
        ...(volumePercent === undefined ? {} : { volumePercent }),
        ...(loopMode === undefined ? {} : { loopMode }),
        ...(queue === undefined ? {} : { queue }),
      };
    } catch {
      return {};
    }
  }

  save(state: PlaybackState): void {
    this.#pending = state;
    if (this.#flushTimer === undefined) {
      const timer = setTimeout(() => {
        this.#flushTimer = undefined;
        void this.#flushPending().catch(() => undefined);
      }, SAVE_DEBOUNCE_MS);
      timer.unref();
      this.#flushTimer = timer;
    }
  }

  flush(): Promise<void> {
    if (this.#flushTimer !== undefined) {
      clearTimeout(this.#flushTimer);
      this.#flushTimer = undefined;
    }
    return this.#flushPending();
  }

  #flushPending(): Promise<void> {
    const state = this.#pending;
    this.#pending = undefined;
    if (state === undefined) return Promise.resolve();
    const write = this.#writeChain.then(() => this.#doWrite(state));
    this.#writeChain = write.catch(() => undefined);
    return write;
  }

  async #doWrite(state: PlaybackState): Promise<void> {
    const directory = dirname(this.filePath);
    if (!this.#directoryChecked) {
      await mkdir(directory, { recursive: true });
      this.#directoryChecked = true;
    }
    const temporary = `${this.filePath}.tmp`;
    await writeFile(temporary, JSON.stringify(state), "utf8");
    await rename(temporary, this.filePath);
  }
}
