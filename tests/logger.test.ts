import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";

import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";

import {
  createRhapsodLogger,
  guardFileStream,
} from "../src/observability/logger.js";

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

describe("guardFileStream", () => {
  // Failure replayed from the August 2026 incident: the rolling file stream
  // could not open its target (fd -1) and every write threw synchronously
  // through multistream, taking the process down on a routine log line.
  const fdError = (): Error =>
    Object.assign(
      new RangeError(
        'The value of "fd" is out of range. It must be >= 0 && <= 2147483647. Received -1',
      ),
      { code: "ERR_OUT_OF_RANGE" },
    );

  interface FakeFileStream {
    write(chunk: unknown): unknown;
    flushSync?(): void;
  }

  function buildLogger(fileStream: FakeFileStream): {
    logger: pino.Logger;
    stdoutLines: string[];
  } {
    const stdoutLines: string[] = [];
    const stdoutCapture = new Writable({
      write(chunk, _encoding, callback) {
        stdoutLines.push(String(chunk));
        callback();
      },
    });
    const logger = pino(
      { level: "info" },
      pino.multistream([
        { stream: stdoutCapture },
        { stream: guardFileStream(fileStream) },
      ]),
    );
    return { logger, stdoutLines };
  }

  it("replays the incident without the guard: the log call throws", () => {
    const broken = {
      write(): unknown {
        throw fdError();
      },
    };
    const stdoutCapture = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    const naked = pino(
      { level: "info" },
      pino.multistream([
        { stream: stdoutCapture },
        { stream: broken as unknown as NodeJS.WritableStream },
      ]),
    );

    expect(() => naked.info("configuration loaded")).toThrow(/out of range/);
  });

  it("keeps serving stdout when the file stream throws like a broken fd", () => {
    const { logger, stdoutLines } = buildLogger({
      write(): unknown {
        throw fdError();
      },
    });

    expect(() => logger.info("configuration loaded")).not.toThrow();
    expect(stdoutLines.join("")).toContain("configuration loaded");
  });

  it("forwards lines untouched to a healthy file stream", () => {
    const fileLines: string[] = [];
    const { logger } = buildLogger({
      write(chunk: unknown): unknown {
        fileLines.push(String(chunk));
        return true;
      },
    });

    logger.info("hello file");
    expect(fileLines.join("")).toContain("hello file");
  });

  it("absorbs flushSync failures from a broken file stream", () => {
    const guard = guardFileStream({
      write(): unknown {
        throw fdError();
      },
      flushSync(): void {
        throw fdError();
      },
    }) as Writable & { flushSync: () => void };

    expect(() => guard.flushSync()).not.toThrow();
  });
});
