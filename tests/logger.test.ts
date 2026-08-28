import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createRhapsodLogger } from "../src/observability/logger.js";

const tempDirs: string[] = [];

function makeTempLogDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "rhapsod-logs-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0))
    rmSync(dir, { force: true, recursive: true });
});

describe("createRhapsodLogger", () => {
  it("writes structured lines to the rotating log file", async () => {
    const logDir = makeTempLogDir();
    const logger = await createRhapsodLogger({
      level: "info",
      logDir,
      retentionDays: 3,
    });

    logger.info(
      { trackId: "abc", firstFrameDelayMs: 1234 },
      "Playback session",
    );
    logger.flush();
    await new Promise((resolve) => setTimeout(resolve, 200));

    const files = readdirSync(logDir);
    const logFile = files.find((file) => file.startsWith("rhapsod"));
    expect(logFile).toBeDefined();
    const content = readFileSync(join(logDir, logFile!), "utf8");
    expect(content).toContain("Playback session");
    expect(content).toContain('"trackId":"abc"');
    expect(content).toContain('"firstFrameDelayMs":1234');
  });

  it("redacts cookies, tokens and URLs embedded in error messages", async () => {
    const logDir = makeTempLogDir();
    const logger = await createRhapsodLogger({
      level: "info",
      logDir,
      retentionDays: 3,
    });

    const secretError = new Error(
      'yt-dlp: ERROR cookies="SID=SECRET" po_token=POabc https://rr5.googlevideo.com/videoplayback?expire=9999&signature=SECRET',
    );
    logger.error({ err: secretError }, "resolution failed");
    logger.flush();
    await new Promise((resolve) => setTimeout(resolve, 200));

    const files = readdirSync(logDir);
    const logFile = files.find((file) => file.startsWith("rhapsod"));
    expect(logFile).toBeDefined();
    const content = readFileSync(join(logDir, logFile!), "utf8");
    expect(content).toContain("cookie=[redacted]");
    expect(content).toContain("po_token=[redacted]");
    expect(content).not.toContain("SID=SECRET");
    expect(content).not.toContain("POabc");
    expect(content).not.toContain("rr5.googlevideo.com");
    expect(content).not.toContain("signature=SECRET");
  });

  it("redacts sensitive values passed as top-level keys", async () => {
    const logDir = makeTempLogDir();
    const logger = await createRhapsodLogger({
      level: "info",
      logDir,
      retentionDays: 3,
    });

    logger.warn(
      { cookies: "SAPISID=SECRET", po_token: "PO-SECRET" },
      "debug dump",
    );
    logger.flush();
    await new Promise((resolve) => setTimeout(resolve, 200));

    const files = readdirSync(logDir);
    const logFile = files.find((file) => file.startsWith("rhapsod"));
    expect(logFile).toBeDefined();
    const content = readFileSync(join(logDir, logFile!), "utf8");
    expect(content).toContain('"cookies":"[REDACTED]"');
    expect(content).toContain('"po_token":"[REDACTED]"');
    expect(content).not.toContain("SAPISID=SECRET");
    expect(content).not.toContain("PO-SECRET");
  });
});
