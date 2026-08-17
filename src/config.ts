import { z } from "zod";

const optionalSecret = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

const configSchema = z.object({
  RHAPSOD_DATA_DIR: z.string().min(1).default("./data"),
  RHAPSOD_LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  RHAPSOD_TS3_CHANNEL_PASSWORD: optionalSecret,
  RHAPSOD_TS3_CHANNEL_NAME: optionalSecret,
  RHAPSOD_TS3_HOST: z.string().min(1),
  RHAPSOD_TS3_NICKNAME: z.string().min(1).max(30).default("Rhapsod"),
  RHAPSOD_TS3_PASSWORD: optionalSecret,
  RHAPSOD_TS3_PORT: z.coerce.number().int().min(1).max(65535).default(9987),
  RHAPSOD_TS3_AUTO_CONNECT: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  RHAPSOD_YTDLP_PATH: z.string().min(1).default("yt-dlp"),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  return configSchema.parse(environment);
}
