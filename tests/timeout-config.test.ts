import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CONFIG_KEYS, loadConfig, validateConfig } from "../src/config.js";
import { describedEnvKeys } from "../src/panel/panel-server.js";
import { timeoutConfigFrom } from "../src/lib/timeout-config.js";

const base = { RHAPSOD_TS3_HOST: "ts.example.com" };

describe("yt-dlp timeouts", () => {
  it("defaults every timeout when unset or empty", () => {
    const expected = {
      search: 8000,
      audioUrl: 12000,
      download: 60000,
      metadata: 30000,
      playlist: 45000,
    };
    expect(timeoutConfigFrom(loadConfig(base))).toEqual(expected);
    expect(
      timeoutConfigFrom(
        loadConfig({
          ...base,
          RHAPSOD_YTDLP_SEARCH_TIMEOUT_MS: "",
          RHAPSOD_YTDLP_PLAYLIST_TIMEOUT_MS: "",
        }),
      ),
    ).toEqual(expected);
  });

  it("reads custom values through the config schema", () => {
    const timeouts = timeoutConfigFrom(
      loadConfig({
        ...base,
        RHAPSOD_YTDLP_SEARCH_TIMEOUT_MS: "10000",
        RHAPSOD_YTDLP_AUDIO_URL_TIMEOUT_MS: "15000",
        RHAPSOD_YTDLP_DOWNLOAD_TIMEOUT_MS: "300000",
        RHAPSOD_YTDLP_METADATA_TIMEOUT_MS: "10000",
        RHAPSOD_YTDLP_PLAYLIST_TIMEOUT_MS: "120000",
      }),
    );
    expect(timeouts).toEqual({
      search: 10000,
      audioUrl: 15000,
      download: 300000,
      metadata: 10000,
      playlist: 120000,
    });
  });

  it.each([
    ["RHAPSOD_YTDLP_SEARCH_TIMEOUT_MS", "3999"],
    ["RHAPSOD_YTDLP_SEARCH_TIMEOUT_MS", "20001"],
    ["RHAPSOD_YTDLP_AUDIO_URL_TIMEOUT_MS", "not-a-number"],
    ["RHAPSOD_YTDLP_DOWNLOAD_TIMEOUT_MS", "-5000"],
    ["RHAPSOD_YTDLP_METADATA_TIMEOUT_MS", "12000.5"],
    ["RHAPSOD_YTDLP_PLAYLIST_TIMEOUT_MS", "999999"],
  ])("rejects %s=%s like every other key", (key, value) => {
    expect(() => loadConfig({ ...base, [key]: value })).toThrow();
    expect(validateConfig({ ...base, [key]: value })).toEqual([
      expect.objectContaining({ key }),
    ]);
  });
});

describe("config keys", () => {
  const example = readFileSync(
    join(import.meta.dirname, "..", ".env.example"),
    "utf8",
  );
  const exampleKeys = [...example.matchAll(/^(RHAPSOD_[A-Z0-9_]+)=/gm)].map(
    (match) => match[1]!,
  );
  const panelKeys = new Set(describedEnvKeys());

  it("keeps .env.example, the schema and the panel in step", () => {
    expect(exampleKeys.filter((key) => !CONFIG_KEYS.includes(key))).toEqual([]);
    expect(exampleKeys.filter((key) => !panelKeys.has(key))).toEqual([]);
    expect(
      CONFIG_KEYS.filter(
        // Only honored from the real environment, never from the env file.
        (key) => key !== "RHAPSOD_ENV_FILE" && !exampleKeys.includes(key),
      ),
    ).toEqual([]);
    expect(CONFIG_KEYS.filter((key) => !panelKeys.has(key))).toEqual([]);
  });
});
