import { join } from "node:path";

import pino, { type Logger } from "pino";
import createRollingStream from "pino-roll";

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
  return pino({ level: options.level }, pino.multistream(streams));
}
