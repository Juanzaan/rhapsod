import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  analyzeLogs,
  classifyPrefetchStatus,
  filterLinesByTime,
  formatStats,
  parseCliArgs,
  parseIsoTime,
  parseLogLine,
  readLogFiles,
} from "../scripts/log-stats.mjs";

const NOW = 1787600000000;

function line(obj: unknown): string {
  return JSON.stringify(obj);
}

function timingLine(
  time: number,
  durationMs: number,
  prefetchStatus?: string,
): string {
  return line({
    level: 30,
    time,
    trackId: "t",
    stage: "audio-url",
    durationMs,
    ...(prefetchStatus === undefined ? {} : { prefetchStatus }),
    msg: "Playback timing",
  });
}

function sessionLine(
  time: number,
  audioUrlMs: number,
  firstFrameDelayMs = 0,
  cacheHit = true,
): string {
  return line({
    level: 30,
    time,
    trackId: "t",
    audioUrlMs,
    firstFrameDelayMs,
    cacheHit,
    msg: "Playback session",
  });
}

describe("log-stats parseLogLine", () => {
  it("parses valid JSON lines and skips invalid ones", () => {
    expect(parseLogLine('{"level":30}')).toEqual({ level: 30 });
    expect(parseLogLine("not json")).toBeUndefined();
    expect(parseLogLine("")).toBeUndefined();
    expect(parseLogLine("null")).toBeUndefined();
  });
});

describe("log-stats parseIsoTime", () => {
  it("parses UTC timestamps", () => {
    expect(parseIsoTime("2026-08-25T04:29:18Z")).toBe(
      new Date("2026-08-25T04:29:18Z").getTime(),
    );
  });

  it("parses numeric offsets", () => {
    const z = new Date("2026-08-25T01:29:18-03:00").getTime();
    expect(parseIsoTime("2026-08-25T01:29:18-03:00")).toBe(z);
    expect(parseIsoTime("2026-08-25T01:29:18-03:00")).toBe(
      new Date("2026-08-25T04:29:18Z").getTime(),
    );
  });

  it("rejects invalid dates", () => {
    expect(parseIsoTime("not-a-date")).toBeUndefined();
    expect(parseIsoTime("2026-13-99T99:99:99Z")).toBeUndefined();
  });
});

describe("log-stats parseCliArgs", () => {
  it("handles --help", () => {
    expect(parseCliArgs(["--help"])).toEqual({ help: true, files: [] });
  });

  it("parses --since and --until", () => {
    const args = parseCliArgs([
      "--since",
      "2026-08-25T04:29:18Z",
      "--until",
      "2026-08-26T19:32:16Z",
      "a.log",
    ]);
    expect(args.error).toBeUndefined();
    expect(args.sinceMs).toBe(new Date("2026-08-25T04:29:18Z").getTime());
    expect(args.untilMs).toBe(new Date("2026-08-26T19:32:16Z").getTime());
    expect(args.files).toEqual(["a.log"]);
  });

  it("rejects invalid dates with a clear message", () => {
    const args = parseCliArgs(["--since", "junk"]);
    expect(args.error).toMatch(/Invalid ISO-8601/);
  });

  it("rejects missing option values", () => {
    expect(parseCliArgs(["--until"])).toMatchObject({
      error: /Missing value/,
    });
  });

  it("fails when since is later than until", () => {
    const args = parseCliArgs([
      "--since",
      "2026-08-26T00:00:00Z",
      "--until",
      "2026-08-25T00:00:00Z",
    ]);
    expect(args.error).toMatch(/--since must not be later than --until/);
  });
});

describe("log-stats filterLinesByTime", () => {
  const lines = [
    sessionLine(NOW, 1000),
    sessionLine(NOW + 1000, 2000),
    sessionLine(NOW + 2000, 3000),
    "invalid line",
  ];

  it("returns everything unchanged when no filters are set", () => {
    const result = filterLinesByTime(lines);
    expect(result.discarded).toBe(0);
    expect(result.lines).toEqual(lines);
  });

  it("filters by --since inclusively", () => {
    const result = filterLinesByTime(lines, NOW + 1000);
    expect(result.discarded).toBe(1);
    expect(result.lines.length).toBe(3);
  });

  it("filters by --until inclusively", () => {
    const result = filterLinesByTime(lines, undefined, NOW + 1000);
    expect(result.discarded).toBe(1);
    expect(result.lines.length).toBe(3);
  });

  it("combines --since and --until", () => {
    const result = filterLinesByTime(lines, NOW + 1000, NOW + 1000);
    expect(result.discarded).toBe(2);
    expect(result.lines.length).toBe(2);
  });

  it("keeps invalid and timestamp-less lines when filtering", () => {
    const mixed = [
      sessionLine(NOW, 1000),
      "invalid",
      line({ level: 30, msg: "no time" }),
    ];
    const result = filterLinesByTime(mixed, NOW + 1);
    expect(result.lines).toContain("invalid");
    expect(result.lines).toContain(line({ level: 30, msg: "no time" }));
  });
});

describe("log-stats classifyPrefetchStatus", () => {
  it("maps known values to normalized groups", () => {
    expect(classifyPrefetchStatus("hit")).toBe("ready");
    expect(classifyPrefetchStatus("in-flight")).toBe("in-flight");
    expect(classifyPrefetchStatus("miss")).toBe("miss");
    expect(classifyPrefetchStatus("not-applicable")).toBe("not-applicable");
    expect(classifyPrefetchStatus("unknown")).toBe("unknown");
  });

  it("maps unrecognized values under other:<value>", () => {
    expect(classifyPrefetchStatus("bogus")).toBe("other:bogus");
    expect(classifyPrefetchStatus(123)).toBe("other:123");
  });

  it("sanitizes control characters and newlines in other:<value>", () => {
    expect(classifyPrefetchStatus("bad\nvalue")).toBe("other:bad value");
    expect(classifyPrefetchStatus("bad\tvalue\r\n")).toBe("other:bad value");
    expect(classifyPrefetchStatus("a\u0000b")).toBe("other:a b");
  });

  it("truncates long other:<value> to ~40 chars", () => {
    const value = "x".repeat(200);
    const result = classifyPrefetchStatus(value);
    expect(result?.startsWith("other:")).toBe(true);
    expect(result?.length).toBeLessThan(60);
    expect(result).toContain("…");
  });

  it("maps control-only or empty other:<value> to a safe placeholder", () => {
    expect(classifyPrefetchStatus("\n\t\r")).toBe("other:(vacío)");
  });

  it("returns undefined for absent values", () => {
    expect(classifyPrefetchStatus(undefined)).toBeUndefined();
    expect(classifyPrefetchStatus(null)).toBeUndefined();
  });
});

describe("log-stats analyzeLogs prefetch groups", () => {
  it("groups by prefetchStatus with correct latency summaries", () => {
    const lines = [
      timingLine(NOW, 100, "hit"),
      timingLine(NOW, 300, "hit"),
      timingLine(NOW, 500, "in-flight"),
      timingLine(NOW, 700, "miss"),
      timingLine(NOW, 900, "not-applicable"),
      timingLine(NOW, 1100, "unknown"),
      timingLine(NOW, 1300, "bogus"),
    ];
    const stats = analyzeLogs(lines);
    expect(stats.prefetch.audioUrlTimings).toBe(7);
    expect(stats.prefetch.withStatus).toBe(7);
    expect(stats.prefetch.missingStatus).toBe(0);
    expect(stats.prefetch.groups.ready).toMatchObject({ count: 2, avg: 200 });
    expect(stats.prefetch.groups["in-flight"]).toMatchObject({ count: 1 });
    expect(stats.prefetch.groups.miss).toMatchObject({ count: 1 });
    expect(stats.prefetch.groups["not-applicable"]).toMatchObject({
      count: 1,
    });
    expect(stats.prefetch.groups.unknown).toMatchObject({ count: 1 });
    expect(stats.prefetch.groups["other:bogus"]).toMatchObject({ count: 1 });
  });

  it("tolerates missing prefetchStatus and counts it", () => {
    const lines = [timingLine(NOW, 100), timingLine(NOW, 200, "hit")];
    const stats = analyzeLogs(lines);
    expect(stats.prefetch.audioUrlTimings).toBe(2);
    expect(stats.prefetch.withStatus).toBe(1);
    expect(stats.prefetch.missingStatus).toBe(1);
    expect(stats.prefetch.groups.ready).toMatchObject({ count: 1 });
    expect(stats.prefetch.groups.unknown).toBeUndefined();
  });

  it("does not fabricate ready from cacheHit alone", () => {
    // Session lines carry cacheHit but no prefetchStatus: they must NOT create a "ready" group.
    const lines = [sessionLine(NOW, 500, 100, true)];
    const stats = analyzeLogs(lines);
    expect(stats.prefetch.audioUrlTimings).toBe(0);
    expect(stats.prefetch.groups.ready).toBeUndefined();
    expect(stats.audioUrlMs).toMatchObject({ count: 1 });
  });

  it("reports no percentiles on empty groups", () => {
    const stats = analyzeLogs([]);
    expect(stats.prefetch.audioUrlTimings).toBe(0);
    expect(Object.keys(stats.prefetch.groups)).toEqual([]);
    expect(stats.audioUrlMs.count).toBe(0);
    expect(stats.audioUrlMs.p50).toBeUndefined();
    expect(stats.audioUrlMs.avg).toBeUndefined();
  });
});

describe("log-stats old-log compatibility", () => {
  it("tolerates missing optional fields without discarding samples", () => {
    const lines = [
      // Old logs may lack firstFrameDelayMs, winners, prefetchStatus, metadataMs.
      line({
        level: 30,
        time: NOW,
        trackId: "a",
        audioUrlMs: 800,
        cacheHit: true,
        msg: "Playback session",
      }),
      timingLine(NOW, 400),
      "invalid",
    ];
    const stats = analyzeLogs(lines);
    expect(stats.parsedCount).toBe(2);
    expect(stats.skipped).toBe(1);
    expect(stats.audioUrlMs.count).toBe(1);
    expect(stats.firstFrameDelayMs.count).toBe(0);
    expect(stats.metadataMs.count).toBe(0);
    expect(stats.prefetch.missingStatus).toBe(1);
    expect(stats.winners).toEqual({});
  });
});

describe("log-stats PII safety", () => {
  it("sanitizes error messages and never leaks URLs/tokens", () => {
    const lines = [
      line({
        level: 50,
        time: NOW,
        msg: "yt-dlp failed: cookie=SECRETVAL po_token=PO123 https://example.com/path",
      }),
    ];
    const stats = analyzeLogs(lines);
    const output = formatStats(stats);
    expect(output).not.toContain("https://example.com");
    expect(output).not.toContain("SECRETVAL");
    expect(output).not.toContain("PO123");
    expect(Object.keys(stats.errorLevel50)[0]).toContain("[redacted]");
  });

  it("formatStats output contains only aggregated metrics", () => {
    const lines = [
      sessionLine(NOW, 800, 150, true),
      timingLine(NOW, 400, "hit"),
    ];
    const output = formatStats(analyzeLogs(lines));
    expect(output).toContain("Rhapsod log-stats");
    expect(output).toContain("audioUrlMs");
    expect(output).toContain("ready");
  });
});

describe("log-stats readLogFiles error handling", () => {
  it("throws a friendly error for a missing file (ENOENT)", () => {
    expect(() =>
      readLogFiles(["Z:/definitely-missing-log-file.log"]),
    ).toThrowError(/no encontrado/);
  });

  it("throws a friendly error for generic read failures (e.g. a directory)", () => {
    const dir = mkdtempSync(join(tmpdir(), "logstats-"));
    try {
      expect(() => readLogFiles([dir])).toThrowError(/No se pudo leer/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("still reads valid files successfully", () => {
    const dir = mkdtempSync(join(tmpdir(), "logstats-"));
    const file = join(dir, "a.log");
    try {
      writeFileSync(file, '{"level":30,"msg":"ok"}\n{"level":30,"msg":"ok"}\n');
      expect(readLogFiles([file])).toEqual([
        '{"level":30,"msg":"ok"}',
        '{"level":30,"msg":"ok"}',
        "",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("log-stats analyzeLogs aggregates", () => {
  it("computes session metrics, cache rate, winners, retries and errors", () => {
    const fixture = [
      sessionLine(NOW, 500, 81, true),
      sessionLine(NOW + 10_000, 3000, 120, false),
      line({
        level: 30,
        time: NOW + 30_000,
        winner: "web_safari",
        attemptCount: 2,
        msg: "Audio URL resolved",
      }),
      line({
        level: 30,
        time: NOW + 31_000,
        msg: "Audio URL attempt failed",
      }),
      line({
        level: 40,
        time: NOW + 32_000,
        msg: "youtubei.js failed; falling back to yt-dlp",
      }),
      line({ level: 50, time: NOW + 33_000, msg: "YouTube playback failed" }),
      "corrupt",
    ];
    const stats = analyzeLogs(fixture);
    expect(stats.parsedCount).toBe(6);
    expect(stats.skipped).toBe(1);
    expect(stats.playbackSessions).toBe(2);
    expect(stats.audioUrlMs.count).toBe(2);
    expect(stats.audioUrlMs.avg).toBe(1750);
    expect(stats.audioUrlMs.p50).toBe(500);
    expect(stats.cacheHitRate).toBe(50);
    expect(stats.winners).toEqual({ web_safari: 1 });
    expect(stats.retries).toBe(2);
    expect(stats.providerFails).toEqual({ "youtubei.js": 1 });
    expect(stats.errorLevel50).toEqual({ "YouTube playback failed": 1 });
  });

  it("returns an empty period for an empty window", () => {
    const stats = analyzeLogs([]);
    expect(stats.period).toBeUndefined();
  });
});
