import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, statfs } from "node:fs/promises";
import { connect } from "node:net";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { resolveFfmpegBinary } from "./audio/ffmpeg-pcm.js";
import { runCli } from "./cli/run-cli.js";
import { APP_VERSION } from "./lib/version.js";
import { loadEnvFile, saveEnvFile } from "./panel/env-file.js";

// Shared by the `rhapsod` wrapper, `docker compose exec` and a future
// Windows service: everything host-specific (systemd, journalctl) stays in
// the wrapper, so this only reads the env file, the panel and the binaries.
const run = promisify(execFile);
const envFilePath = resolve(process.env.RHAPSOD_ENV_FILE ?? ".env");

async function firstLine(
  binary: string,
  args: readonly string[],
): Promise<string> {
  const { stdout } = await run(binary, args, { timeout: 10_000 });
  return stdout.split(/\r?\n/)[0]?.trim() ?? "";
}

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ host, port, timeout: 3000 });
    const finish = (ok: boolean): void => {
      socket.destroy();
      done(ok);
    };
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function clockSynced(): Promise<boolean | undefined> {
  try {
    const answer = await firstLine("timedatectl", [
      "show",
      "-p",
      "NTPSynchronized",
      "--value",
    ]);
    return answer === "yes" ? true : answer === "no" ? false : undefined;
  } catch {
    return undefined;
  }
}

const fileValues = loadEnvFile(envFilePath).values;

process.exitCode = await runCli(process.argv.slice(2), {
  env: { ...fileValues, ...process.env },
  envFilePath,
  version: APP_VERSION,
  nodeVersion: process.version,
  fetch,
  firstLine,
  canConnect,
  freeBytes: async (path) => {
    const stats = await statfs(path);
    return stats.bavail * stats.bsize;
  },
  clockSynced,
  readText: (path) => readFile(path, "utf8").catch(() => undefined),
  saveEnv: saveEnvFile,
  loadEnv: (path) => loadEnvFile(path).values,
  generatePassword: () => randomBytes(12).toString("hex"),
  defaultFfmpeg: resolveFfmpegBinary(undefined),
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
});
