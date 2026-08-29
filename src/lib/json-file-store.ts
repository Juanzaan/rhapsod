import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Shared atomic JSON persistence: writes go to a sibling temp file that is
 * renamed over the target (an atomic commit on the same volume), and reads
 * validate + recover from corrupt files instead of throwing.
 */
export function readJsonFile<T>(
  filePath: string,
  validate: (raw: unknown) => T | undefined,
): T | undefined {
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
  try {
    return validate(JSON.parse(content) as unknown);
  } catch {
    return undefined;
  }
}

export async function writeJsonFile(
  filePath: string,
  data: unknown,
): Promise<void> {
  const directory = dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporary = `${filePath}.tmp`;
  await writeFile(temporary, JSON.stringify(data, null, 2), "utf8");
  await rename(temporary, filePath);
}
