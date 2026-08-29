import { readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export interface EnvFile {
  readonly path: string;
  values: Record<string, string>;
}

export function parseEnvFile(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
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

export async function saveEnvFile(
  filePath: string,
  values: Record<string, string>,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const lines = Object.entries(values)
    .filter(([, value]) => value !== "")
    .map(([key, value]) => `${key}=${value}`);
  writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

export function maskSecret(value: string | undefined): string {
  if (value === undefined || value === "") return "";
  return value.length <= 4
    ? "****"
    : `${value.slice(0, 2)}***${value.slice(-2)}`;
}
