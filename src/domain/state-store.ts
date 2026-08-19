import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { LoopMode } from "../application/youtube-playback-service.js";

export interface PlaybackState {
  readonly loopMode?: LoopMode;
  readonly volumePercent?: number;
}

export interface PlaybackStateStore {
  load(): PlaybackState;
  save(state: PlaybackState): void;
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
      return {
        ...(volumePercent === undefined ? {} : { volumePercent }),
        ...(loopMode === undefined ? {} : { loopMode }),
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
