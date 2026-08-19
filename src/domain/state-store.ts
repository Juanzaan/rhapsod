import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { LoopMode } from "../application/youtube-playback-service.js";

export interface SerializedQueueTrack {
  readonly durationSeconds?: number;
  readonly id: string;
  readonly requestedBy: string;
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
}

const MAX_QUEUE_ENTRIES = 1000;

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
    entries.push({
      ...(durationSeconds === undefined ? {} : { durationSeconds }),
      id: record.id,
      requestedBy: record.requestedBy,
      source: record.source,
      title: record.title,
    });
    if (entries.length >= MAX_QUEUE_ENTRIES) break;
  }
  return entries;
}

export class FilePlaybackStateStore implements PlaybackStateStore {
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
    const directory = dirname(this.filePath);
    mkdirSync(directory, { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    writeFileSync(temporary, JSON.stringify(state), "utf8");
    renameSync(temporary, this.filePath);
  }
}
