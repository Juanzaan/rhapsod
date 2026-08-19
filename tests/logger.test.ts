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
});
