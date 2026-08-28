import { join } from "node:path";

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
    roll.on("error", () => {
      // A failing log file must never take the bot down.
    });
    streams.push({ stream: roll });
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
