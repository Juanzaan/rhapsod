import { readFileSync } from "node:fs";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";

export interface EnvFile {
  readonly path: string;
  values: Record<string, string>;
}

const ENV_LINE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/;

export function parseEnvFile(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const match = ENV_LINE.exec(line);
    if (!match) continue;
    values[match[1]!] = match[2] ?? "";
  }
  return values;
}

export function loadEnvFile(filePath: string): EnvFile {
  let content = "";
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    // Missing file: start with an empty env.
  }
  return { path: filePath, values: parseEnvFile(content) };
}

/**
 * A value is written verbatim as `KEY=value`, so a line break inside it
 * would start a new assignment and smuggle an arbitrary variable (for
 * example NODE_OPTIONS) past the caller's key whitelist.
 */
export function isSafeEnvValue(value: string): boolean {
  return !/[\r\n\0]/.test(value);
}

/**
 * Rewrites the file in place of its assignments: comments, blank lines and
 * ordering survive, removed keys disappear, new keys are appended. The write
 * goes through a temp file and a rename so a crash never leaves a truncated
 * env file, and it keeps the original permission bits (the file holds
 * secrets and is usually 0600).
 */
export async function saveEnvFile(
  filePath: string,
  values: Record<string, string>,
): Promise<void> {
  for (const [key, value] of Object.entries(values)) {
    if (!isSafeEnvValue(value)) {
      throw new Error(`Unsafe value for ${key}: line breaks are not allowed`);
    }
  }
  await mkdir(dirname(filePath), { recursive: true });
  let original = "";
  let mode = 0o600;
  try {
    original = await readFile(filePath, "utf8");
    mode = (await stat(filePath)).mode & 0o777;
  } catch {
    // Missing file: create it private.
  }
  const pending = new Map(
    Object.entries(values).filter(([, value]) => value !== ""),
  );
  const lines: string[] = [];
  for (const line of original.split(/\r?\n/)) {
    const key = ENV_LINE.exec(line)?.[1];
    if (key === undefined) {
      lines.push(line);
      continue;
    }
    const value = pending.get(key);
    // Removed keys and later duplicates of a key are dropped.
    if (value === undefined) continue;
    lines.push(`${key}=${value}`);
    pending.delete(key);
  }
  while (lines.length > 0 && lines.at(-1) === "") lines.pop();
  for (const [key, value] of pending) lines.push(`${key}=${value}`);
  const content = `${lines.join("\n")}\n`;

  const temporary = `${filePath}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: "utf8", mode });
    await chmod(temporary, mode);
    await rename(temporary, filePath);
  } catch {
    // The rename cannot replace a single-file Docker bind mount (EBUSY) or
    // write next to a file in a directory the bot does not own (/etc):
    // fall back to writing the file in place.
    await rm(temporary, { force: true }).catch(() => undefined);
    await writeFile(filePath, content, "utf8");
  }
}

export function maskSecret(value: string | undefined): string {
  if (value === undefined || value === "") return "";
  return value.length <= 4
    ? "****"
    : `${value.slice(0, 2)}***${value.slice(-2)}`;
}
