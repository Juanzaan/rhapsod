declare module "pino-roll" {
  interface PinoRollLimit {
    count?: number;
    removeOtherLogFiles?: boolean;
  }

  interface PinoRollOptions {
    file: string | (() => string);
    size?: number | string;
    frequency?: "daily" | "hourly" | number;
    extension?: string;
    symlink?: boolean;
    limit?: PinoRollLimit;
    dateFormat?: string;
    mkdir?: boolean;
  }

  export default function pinoRoll(
    options: PinoRollOptions,
  ): Promise<NodeJS.WritableStream>;
}
