import { z } from "zod";

const optionalSecret = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

const configSchema = z.object({
  RHAPSOD_LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  RHAPSOD_TS3_CHANNEL_ID: optionalSecret,
  RHAPSOD_TS3_CHANNEL_PASSWORD: optionalSecret,
  RHAPSOD_TS3_HOST: z.string().min(1),
  RHAPSOD_TS3_NICKNAME: z.string().min(1).max(30).default("Rhapsod"),
  RHAPSOD_TS3_PASSWORD: optionalSecret,
  RHAPSOD_TS3_PORT: z.coerce.number().int().min(1).max(65535).default(9987),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  return configSchema.parse(environment);
}
