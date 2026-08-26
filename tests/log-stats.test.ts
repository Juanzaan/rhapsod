import { describe, expect, it } from "vitest";

import { analyzeLogs, parseLogLine } from "../scripts/log-stats.mjs";

const NOW = 1787600000000;

function line(obj: unknown): string {
  return JSON.stringify(obj);
}

describe("log-stats parseLogLine", () => {
  it("parses valid JSON lines and skips invalid ones", () => {
    expect(parseLogLine('{"level":30}')).toEqual({ level: 30 });
    expect(parseLogLine("not json")).toBeUndefined();
    expect(parseLogLine("")).toBeUndefined();
    expect(parseLogLine("null")).toBeUndefined();
  });
});

describe("log-stats analyzeLogs", () => {
  const fixture = [
    line({
      level: 30,
      time: NOW,
      trackId: "a",
      audioUrlMs: 500,
      metadataMs: 1200,
      firstFrameDelayMs: 81,
      cacheHit: true,
      msg: "Playback session",
    }),
    line({
      level: 30,
      time: NOW + 10_000,
      trackId: "b",
      audioUrlMs: 3000,
      metadataMs: 1500,
      firstFrameDelayMs: 120,
      cacheHit: false,
      msg: "Playback session",
    }),
    line({
      level: 30,
      time: NOW + 20_000,
      trackId: "b",
      audioUrlMs: 3000,
      cacheHit: false,
      msg: "Playback session",
    }),
    line({
      level: 30,
      time: NOW + 30_000,
      winner: "web_safari",
      attemptCount: 1,
      msg: "Audio URL resolved",
    }),
    line({
      level: 30,
      time: NOW + 31_000,
      winner: "web_embedded",
      attemptCount: 2,
      msg: "Audio URL resolved",
    }),
    line({
      level: 30,
      time: NOW + 32_000,
      msg: "Audio URL attempt failed",
    }),
    line({
      level: 40,
      time: NOW + 33_000,
      msg: "youtubei.js failed; falling back to yt-dlp",
    }),
    line({ level: 50, time: NOW + 34_000, msg: "YouTube playback failed" }),
    line({ level: 50, time: NOW + 35_000, msg: "YouTube playback failed" }),
    "corrupt line",
    "",
  ];

  const stats = analyzeLogs(fixture);

  it("counts parsed and skipped lines", () => {
    expect(stats.parsedCount).toBe(9);
    expect(stats.skipped).toBe(2);
  });

  it("computes playback session metrics", () => {
    expect(stats.playbackSessions).toBe(3);
    expect(stats.audioUrlMs.count).toBe(3);
    expect(stats.audioUrlMs.avg).toBe(2167); // (500+3000+3000)/3
    expect(stats.audioUrlMs.p50).toBe(3000);
    expect(stats.audioUrlMs.max).toBe(3000);
    expect(stats.metadataMs.count).toBe(2);
    expect(stats.metadataMs.p50).toBe(1200); // nearest-rank over [1200,1500]
    expect(stats.firstFrameDelayMs.count).toBe(2);
  });

  it("computes cache hit rate", () => {
    expect(stats.cacheHits.hit).toBe(1);
    expect(stats.cacheHits.miss).toBe(2);
    expect(stats.cacheHitRate).toBe(33.3);
  });

  it("breaks down winners and retries", () => {
    expect(stats.winners).toEqual({ web_safari: 1, web_embedded: 1 });
    expect(stats.retries).toBe(2); // 1 from attemptCount=2, 1 from "Audio URL attempt failed"
  });

  it("counts provider failures and error levels", () => {
    expect(stats.providerFails).toEqual({ "youtubei.js": 1 });
    expect(stats.errorLevel50).toEqual({
      "YouTube playback failed": 2,
    });
  });

  it("reports the analyzed period", () => {
    expect(stats.period).toBeDefined();
    expect(stats.period?.from).toBe(new Date(NOW).toISOString());
  });
});
