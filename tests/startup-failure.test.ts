import { spawn } from "node:child_process";
import { createSocket } from "node:dgram";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

function freeUdpPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = createSocket("udp4");
    socket.once("error", reject);
    socket.bind(0, "127.0.0.1", () => {
      const { port } = socket.address();
      socket.close(() => resolve(port));
    });
  });
}

describe("startup against an unreachable TeamSpeak server", () => {
  it("exits with code 1 so systemd restarts it", async () => {
    const directory = mkdtempSync(join(tmpdir(), "rhapsod-startup-"));
    writeFileSync(join(directory, ".env"), "");
    const port = await freeUdpPort();
    const child = spawn(
      process.execPath,
      [
        "--import",
        import.meta.resolve("tsx"),
        fileURLToPath(new URL("../src/main.ts", import.meta.url)),
      ],
      {
        cwd: directory,
        env: {
          PATH: process.env.PATH ?? "",
          RHAPSOD_DATA_DIR: join(directory, "data"),
          RHAPSOD_ENV_FILE: join(directory, ".env"),
          RHAPSOD_METRICS_INTERVAL_MINUTES: "0",
          RHAPSOD_TS3_CONNECT_TIMEOUT_SECONDS: "15",
          RHAPSOD_TS3_HOST: "127.0.0.1",
          RHAPSOD_TS3_PORT: String(port),
          RHAPSOD_WATCHDOG_INTERVAL_SECONDS: "0",
          ...(process.env.SYSTEMROOT === undefined
            ? {}
            : { SYSTEMROOT: process.env.SYSTEMROOT }),
        },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    try {
      const code = await new Promise<number | null>((resolve) =>
        child.once("exit", (exitCode) => resolve(exitCode)),
      );
      // Before the fix the process ended with 0 as soon as the UDP socket
      // closed: the connect timeout's timer did not hold the event loop.
      expect(code, stderr).toBe(1);
      expect(stderr).toContain("Rhapsod failed to start");
    } finally {
      child.kill("SIGKILL");
      rmSync(directory, { force: true, maxRetries: 3, recursive: true });
    }
  }, 60_000);
});
