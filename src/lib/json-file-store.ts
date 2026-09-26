import { readFileSync, renameSync } from "node:fs";
import { mkdir, open, rename } from "node:fs/promises";
import { basename, dirname } from "node:path";

import type { MinimalLogger } from "../observability/logger.js";

/**
 * Shared atomic JSON persistence: writes go to a sibling temp file that is
 * renamed over the target (an atomic commit on the same volume), and reads
 * validate + recover from corrupt files instead of throwing.
 */
export function readJsonFile<T>(
  filePath: string,
  validate: (raw: unknown) => T | undefined,
  logger?: MinimalLogger,
): T | undefined {
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
  let parsed: T | undefined;
  try {
    parsed = validate(JSON.parse(content) as unknown);
  } catch {
    parsed = undefined;
  }
  if (parsed === undefined) quarantineUnreadableFile(filePath, logger);
  return parsed;
}

/**
 * Moves a file the store cannot read out of the way before the next write
 * replaces it. Starting fresh used to mean the first save silently destroyed
 * every playlist or favorite in a file that a crash, a manual edit or a newer
 * version had left unreadable; the copy keeps them recoverable by hand.
 */
export function quarantineUnreadableFile(
  filePath: string,
  logger?: MinimalLogger,
): string | undefined {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = `${filePath}.corrupt-${stamp}`;
  try {
    renameSync(filePath, target);
  } catch (error) {
    logger?.error(
      { err: error, file: basename(filePath) },
      "Unreadable data file could not be set aside; the next save replaces it",
    );
    return undefined;
  }
  logger?.warn(
    { file: basename(filePath), savedAs: basename(target) },
    "Unreadable data file set aside; starting fresh",
  );
  return target;
}

/**
 * Temp file + fsync + rename. Without the fsync, a power loss shortly after
 * the rename can leave the renamed file empty on ext4/xfs, which the next
 * start reads as corrupt.
 */
export async function writeFileAtomic(
  filePath: string,
  content: string,
  mode?: number,
): Promise<void> {
  const directory = dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporary = `${filePath}.tmp`;
  const handle = await open(temporary, "w", mode);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, filePath);
  await syncDirectory(directory);
}

export async function writeJsonFile(
  filePath: string,
  data: unknown,
): Promise<void> {
  await writeFileAtomic(filePath, JSON.stringify(data, null, 2));
}

// Persists the rename itself. Windows cannot open a directory for fsync, and
// the data is already safe in the file, so a failure here is not an error.
async function syncDirectory(directory: string): Promise<void> {
  try {
    const handle = await open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // best effort
  }
}

/**
 * Coalesces saves of a whole-file store. Listening history and the song
 * library used to serialize and write their entire file on every recorded
 * play, on the event loop that also paces voice frames. Changes now mark the
 * store dirty and one write runs after `delayMs`, reading the state at that
 * moment; `flush()` writes immediately and is what shutdown awaits.
 */
export class DebouncedWriter {
  readonly #write: () => Promise<void>;
  readonly #delayMs: number;
  #timer: NodeJS.Timeout | undefined;
  #dirty = false;
  #chain: Promise<void> = Promise.resolve();

  constructor(write: () => Promise<void>, delayMs = 5_000) {
    this.#write = write;
    this.#delayMs = delayMs;
  }

  schedule(): void {
    this.#dirty = true;
    if (this.#timer !== undefined) return;
    const timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#drain();
    }, this.#delayMs);
    timer.unref();
    this.#timer = timer;
  }

  async flush(): Promise<void> {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    await this.#drain();
  }

  #drain(): Promise<void> {
    if (this.#dirty) {
      this.#dirty = false;
      this.#chain = this.#chain
        .then(() => this.#write())
        .catch(() => undefined);
    }
    return this.#chain;
  }
}
