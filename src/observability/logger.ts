import { join } from "node:path";
import { Writable } from "node:stream";

import pino, { type Logger } from "pino";
import createRollingStream from "pino-roll";

import { sanitizeSensitive, sanitizeUrl } from "./metrics.js";

export interface MinimalLogger {
  readonly error: (...args: unknown[]) => void;
  readonly warn: (...args: unknown[]) => void;
  readonly info: (...args: unknown[]) => void;
  readonly debug: (...args: unknown[]) => void;
}

export const noopLogger: MinimalLogger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
};

export interface RhapsodLoggerOptions {
  readonly level: string;
  readonly logDir?: string;
  readonly retentionDays?: number;
}

const REDACT_PATHS = [
  "cookie",
  "cookies",
  "*.cookie",
  "*.cookies",
  "po_token",
  "*.po_token",
  "authorization",
  "*.authorization",
  "*.headers.cookie",
  "*.headers.authorization",
  "req.headers.cookie",
  "req.headers.authorization",
];

function scrubErrorText(input: string): string {
  return sanitizeUrl(sanitizeSensitive(input));
}

interface ScrubbedErrorLog {
  readonly message: string;
  readonly stack?: string;
  readonly type: string;
}

function serializeError(err: unknown): ScrubbedErrorLog {
  const error = err instanceof Error ? err : new Error(String(err));
  const type = error.constructor.name;
  const message = scrubErrorText(error.message);
  const stack =
    typeof error.stack === "string" ? scrubErrorText(error.stack) : undefined;
  return {
    message,
    ...(stack === undefined ? {} : { stack }),
    type,
  };
}

interface FileLogStream {
  write(chunk: unknown): unknown;
  flushSync?(): void;
}

let lastFileStreamErrorAt = 0;

function reportFileStreamError(error: unknown): void {
  const now = Date.now();
  if (now - lastFileStreamErrorAt < 60_000) return;
  lastFileStreamErrorAt = now;
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[rhapsod] log file stream error: ${message}\n`);
}

// A rolling file stream whose target cannot be opened keeps fd -1 and throws
// synchronously on write; our pino forwards that throw through multistream
// into the logging call, which took the process down as "fd out of range".
// The wrapper degrades to dropping file lines instead of crashing.
export function guardFileStream(stream: FileLogStream): NodeJS.WritableStream {
  const guard = new Writable({
    decodeStrings: false,
    write(chunk, _encoding, callback) {
      try {
        stream.write(chunk);
      } catch (error) {
        reportFileStreamError(error);
      }
      callback();
    },
  });
  if (typeof stream.flushSync === "function") {
    const flushSync = stream.flushSync.bind(stream);
    (guard as Writable & { flushSync: () => void }).flushSync = () => {
      try {
        flushSync();
      } catch (error) {
        reportFileStreamError(error);
      }
    };
  }
  return guard;
}

export async function createRhapsodLogger(
  options: RhapsodLoggerOptions,
): Promise<Logger> {
  const streams: Array<{ stream: NodeJS.WritableStream }> = [
    { stream: pino.destination(1) as unknown as NodeJS.WritableStream },
  ];
  if (options.logDir !== undefined) {
    const roll = await createRollingStream({
      file: join(options.logDir, "rhapsod.log"),
      frequency: "daily",
      dateFormat: "yyyy-MM-dd",
      mkdir: true,
      ...(options.retentionDays === undefined
        ? {}
        : { limit: { count: options.retentionDays } }),
    });
    roll.on("error", reportFileStreamError);
    streams.push({ stream: guardFileStream(roll) });
  }
  return pino(
    {
      level: options.level,
      redact: { censor: "[REDACTED]", paths: REDACT_PATHS },
      serializers: { err: serializeError },
    },
    pino.multistream(streams),
  );
}
