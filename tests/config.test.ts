import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("loads a minimal TeamSpeak configuration", () => {
    const config = loadConfig({ RHAPSOD_TS3_HOST: "ts.example.com" });
    expect(config).toMatchObject({
      RHAPSOD_LOG_LEVEL: "info",
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
    expect(config.RHAPSOD_FFMPEG_PATH).toBeUndefined();
    expect(config.RHAPSOD_ADMIN_UIDS).toBe("");
    expect(config.RHAPSOD_DATA_DIR).toBe("./data");
  });

  it("loads configured admin uids", () => {
    const config = loadConfig({
      RHAPSOD_ADMIN_UIDS: "UID1,UID2",
      RHAPSOD_TS3_HOST: "ts.example.com",
    });
    expect(config.RHAPSOD_ADMIN_UIDS).toBe("UID1,UID2");
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
});
