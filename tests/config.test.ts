import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("loads a minimal TeamSpeak configuration", () => {
    const config = loadConfig({ RHAPSOD_TS3_HOST: "ts.example.com" });
    expect(config).toMatchObject({
      RHAPSOD_LOG_LEVEL: "info",
      RHAPSOD_LOG_RETENTION_DAYS: 14,
      RHAPSOD_TS3_HOST: "ts.example.com",
      RHAPSOD_TS3_NICKNAME: "Rhapsod",
      RHAPSOD_TS3_PORT: 9987,
      RHAPSOD_TS3_CONNECT_TIMEOUT_SECONDS: 180,
      RHAPSOD_OPUS_BITRATE: 96000,
      RHAPSOD_OPUS_COMPLEXITY: 10,
      RHAPSOD_OPUS_PACKET_LOSS_PERCENT: 0,
      RHAPSOD_LOUDNESS_TARGET_LUFS: -14,
      RHAPSOD_YTDLP_PATH: "yt-dlp",
      RHAPSOD_WATCHDOG_INTERVAL_MINUTES: 15,
      RHAPSOD_MAX_CONCURRENT_COMMANDS: 3,
      RHAPSOD_MAX_QUEUE_TRACKS: 200,
      RHAPSOD_MAX_TRACKS_PER_USER: 30,
    });
    expect(config.RHAPSOD_YTDLP_COOKIES_PATH).toBeUndefined();
    expect(config.RHAPSOD_MAX_CONCURRENT_YTDLP_JOBS).toBeUndefined();
    expect(config.RHAPSOD_FFMPEG_PATH).toBeUndefined();
    expect(config.RHAPSOD_FFMPEG_USER_AGENT).toBeUndefined();
    expect(config.RHAPSOD_FFPROBE_PATH).toBeUndefined();
    expect(config.RHAPSOD_ADMIN_UIDS).toBe("");
    expect(config.RHAPSOD_DATA_DIR).toBe("./data");
  });

  it("loads optional FFmpeg probe settings", () => {
    const config = loadConfig({
      RHAPSOD_FFMPEG_USER_AGENT: "Rhapsod/1.0",
      RHAPSOD_FFPROBE_PATH: "/usr/bin/ffprobe",
      RHAPSOD_TS3_HOST: "ts.example.com",
    });
    expect(config.RHAPSOD_FFMPEG_USER_AGENT).toBe("Rhapsod/1.0");
    expect(config.RHAPSOD_FFPROBE_PATH).toBe("/usr/bin/ffprobe");
  });

  it("loads log retention settings", () => {
    const config = loadConfig({
      RHAPSOD_LOG_RETENTION_DAYS: "30",
      RHAPSOD_TS3_HOST: "ts.example.com",
    });
    expect(config.RHAPSOD_LOG_RETENTION_DAYS).toBe(30);
  });

  it("loads configured admin uids", () => {
    const config = loadConfig({
      RHAPSOD_ADMIN_UIDS: "UID1,UID2",
      RHAPSOD_TS3_HOST: "ts.example.com",
    });
    expect(config.RHAPSOD_ADMIN_UIDS).toBe("UID1,UID2");
  });

  it("loads the optional yt-dlp concurrency limit", () => {
    const config = loadConfig({
      RHAPSOD_MAX_CONCURRENT_YTDLP_JOBS: "3",
      RHAPSOD_TS3_HOST: "ts.example.com",
    });

    expect(config.RHAPSOD_MAX_CONCURRENT_YTDLP_JOBS).toBe(3);
  });

  it("rejects invalid voice ports", () => {
    expect(() =>
      loadConfig({
        RHAPSOD_TS3_HOST: "ts.example.com",
        RHAPSOD_TS3_PORT: "70000",
      }),
    ).toThrow();
  });

  it("normalizes empty secrets to undefined", () => {
    const config = loadConfig({
      RHAPSOD_TS3_HOST: "ts.example.com",
      RHAPSOD_TS3_PASSWORD: "",
    });
    expect(config.RHAPSOD_TS3_PASSWORD).toBeUndefined();
  });

  it("loads the optional yt-dlp extractor args", () => {
    const config = loadConfig({
      RHAPSOD_TS3_HOST: "ts.example.com",
      RHAPSOD_YTDLP_EXTRACTOR_ARGS:
        "youtube:po_token_uri=http://localhost:4416",
    });
    expect(config.RHAPSOD_YTDLP_EXTRACTOR_ARGS).toBe(
      "youtube:po_token_uri=http://localhost:4416",
    );
  });

  it("normalizes empty extractor args to undefined", () => {
    const config = loadConfig({
      RHAPSOD_TS3_HOST: "ts.example.com",
      RHAPSOD_YTDLP_EXTRACTOR_ARGS: "",
    });
    expect(config.RHAPSOD_YTDLP_EXTRACTOR_ARGS).toBeUndefined();
  });
});
