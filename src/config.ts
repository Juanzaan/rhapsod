import { z } from "zod";

const optionalSecret = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

const optionalPositiveInteger = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.coerce.number().int().min(1).max(4).optional(),
);

const configSchema = z.object({
  RHAPSOD_ADMIN_UIDS: z.string().default(""),
  RHAPSOD_ENV_FILE: z.string().min(1).default(".env"),
  RHAPSOD_PRIVATE_COMMAND_UIDS: z.string().default(""),
  RHAPSOD_DATA_DIR: z.string().min(1).default("./data"),
  RHAPSOD_FFMPEG_PATH: optionalSecret,
  RHAPSOD_FFMPEG_USER_AGENT: optionalSecret,
  RHAPSOD_FFPROBE_PATH: optionalSecret,
  RHAPSOD_LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  RHAPSOD_MOVE_GROUP_IDS: z.string().default(""),
  RHAPSOD_MOVE_ADMIN_CHANNELS: z.string().default(""),
  RHAPSOD_MOVE_SENIOR_CHANNELS: z.string().default(""),
  RHAPSOD_MOVE_ADMIN_GROUP_IDS: z.string().default(""),
  RHAPSOD_MOVE_SENIOR_GROUP_IDS: z.string().default(""),
  RHAPSOD_LOG_RETENTION_DAYS: z.coerce
    .number()
    .int()
    .min(1)
    .max(90)
    .default(14),
  RHAPSOD_METRICS_INTERVAL_MINUTES: z.coerce
    .number()
    .int()
    .min(0)
    .max(120)
    .default(15),
  RHAPSOD_WATCHDOG_INTERVAL_MINUTES: z.coerce
    .number()
    .int()
    .min(0)
    .max(1440)
    .default(15),
  RHAPSOD_MAX_CONCURRENT_COMMANDS: z.coerce
    .number()
    .int()
    .min(1)
    .max(20)
    .default(3),
  RHAPSOD_MAX_CONCURRENT_YTDLP_JOBS: optionalPositiveInteger,
  RHAPSOD_MAX_QUEUE_TRACKS: z.coerce
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(200),
  RHAPSOD_MAX_TRACKS_PER_USER: z.coerce
    .number()
    .int()
    .min(1)
    .max(200)
    .default(30),
  RHAPSOD_AUDIO_TEST_TONE_SECONDS: z.coerce.number().min(0).max(10).default(0),
  RHAPSOD_OPUS_BITRATE: z.coerce
    .number()
    .int()
    .min(64_000)
    .max(160_000)
    .default(96_000),
  RHAPSOD_OPUS_COMPLEXITY: z.coerce.number().int().min(0).max(10).default(10),
  RHAPSOD_OPUS_PACKET_LOSS_PERCENT: z.coerce
    .number()
    .int()
    .min(0)
    .max(30)
    .default(0),
  RHAPSOD_LOUDNESS_TARGET_LUFS: z.coerce.number().min(-30).max(0).default(-14),
  RHAPSOD_SPOTIFY_CLIENT_ID: optionalSecret,
  RHAPSOD_SPOTIFY_CLIENT_SECRET: optionalSecret,
  RHAPSOD_SPOTIFY_REFRESH_TOKEN: optionalSecret,
  RHAPSOD_TS3_CHANNEL_PASSWORD: optionalSecret,
  RHAPSOD_TS3_CHANNEL_NAME: optionalSecret,
  RHAPSOD_TS3_CHANNEL_ID: z.coerce.number().int().positive().optional(),
  RHAPSOD_TS3_CONNECT_TIMEOUT_SECONDS: z.coerce
    .number()
    .int()
    .min(15)
    .max(300)
    .default(180),
  RHAPSOD_TS3_HEARTBEAT_SECONDS: z.coerce
    .number()
    .int()
    .min(0)
    .max(3600)
    .default(60),
  RHAPSOD_TS3_HOST: z.string().min(1),
  RHAPSOD_TS3_NICKNAME: z.string().min(1).max(30).default("Rhapsod"),
  RHAPSOD_TS3_PASSWORD: optionalSecret,
  RHAPSOD_TS3_PORT: z.coerce.number().int().min(1).max(65535).default(9987),
  RHAPSOD_TS3_AUTO_CONNECT: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  RHAPSOD_TS3_CLIENT_DESCRIPTION: z.string().optional(),
  RHAPSOD_YTDLP_PATH: z.string().min(1).default("yt-dlp"),
  RHAPSOD_YTDLP_COOKIES_PATH: optionalSecret,
  RHAPSOD_YTDLP_EXTRACTOR_ARGS: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().optional(),
  ),
  RHAPSOD_YTDLP_DAEMON_URL: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().url().optional(),
  ),
  RHAPSOD_PANEL_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  RHAPSOD_PANEL_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  RHAPSOD_PANEL_HOST: z.string().min(1).default("127.0.0.1"),
  RHAPSOD_PANEL_USER: z.string().min(1).default("admin"),
  RHAPSOD_PANEL_PASSWORD: z.string().min(1).default("rhapsod"),
  RHAPSOD_VERBOSE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  return configSchema.parse(environment);
}
