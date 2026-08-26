#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MAX_SAMPLES = 20_000;

function percentile(sorted, p) {
  if (sorted.length === 0) return undefined;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((sorted.length * p) / 100) - 1),
  );
  return sorted[idx];
}

function summarize(values) {
  if (values.length === 0) return { count: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    count: sorted.length,
    avg: Math.round(sum / sorted.length),
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1],
  };
}

export function parseLogLine(line) {
  try {
    const parsed = JSON.parse(line);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function analyzeLogs(lines) {
  const audioUrlMs = [];
  const metadataMs = [];
  const firstFrameDelayMs = [];
  const cacheHits = { hit: 0, miss: 0 };
  const winners = new Map();
  const providerFails = new Map();
  const errorLevel50 = new Map();
  let skipped = 0;
  let parsedCount = 0;
  let retries = 0;
  let playbackSessions = 0;
  let playbackTimings = 0;
  let start = Infinity;
  let end = -Infinity;

  for (const line of lines) {
    const record = parseLogLine(line);
    if (record === undefined) {
      skipped++;
      continue;
    }
    parsedCount++;
    if (typeof record.time === "number") {
      if (record.time < start) start = record.time;
      if (record.time > end) end = record.time;
    }

    if (record.msg === "Playback session") {
      playbackSessions++;
      if (typeof record.audioUrlMs === "number")
        audioUrlMs.push(record.audioUrlMs);
      if (typeof record.metadataMs === "number")
        metadataMs.push(record.metadataMs);
      if (typeof record.firstFrameDelayMs === "number")
        firstFrameDelayMs.push(record.firstFrameDelayMs);
      if (record.cacheHit === true) cacheHits.hit++;
      else if (record.cacheHit === false) cacheHits.miss++;
    } else if (record.msg === "Playback timing") {
      playbackTimings++;
    } else if (record.msg === "Audio URL resolved") {
      if (typeof record.winner === "string") {
        winners.set(record.winner, (winners.get(record.winner) ?? 0) + 1);
      }
      if (typeof record.attemptCount === "number" && record.attemptCount > 1) {
        retries += record.attemptCount - 1;
      }
    } else if (record.msg === "Audio URL attempt failed") {
      retries++;
    }

    if (
      typeof record.msg === "string" &&
      record.msg.includes("youtubei.js failed")
    ) {
      providerFails.set(
        "youtubei.js",
        (providerFails.get("youtubei.js") ?? 0) + 1,
      );
    }

    if (record.level === 50 && typeof record.msg === "string") {
      errorLevel50.set(record.msg, (errorLevel50.get(record.msg) ?? 0) + 1);
    }
  }

  const period =
    Number.isFinite(start) && Number.isFinite(end)
      ? {
          from: new Date(start).toISOString(),
          to: new Date(end).toISOString(),
        }
      : undefined;

  return {
    parsedCount,
    skipped,
    period,
    playbackSessions,
    playbackTimings,
    audioUrlMs: summarize(audioUrlMs),
    metadataMs: summarize(metadataMs),
    firstFrameDelayMs: summarize(firstFrameDelayMs),
    cacheHitRate:
      cacheHits.hit + cacheHits.miss > 0
        ? Number(
            ((cacheHits.hit / (cacheHits.hit + cacheHits.miss)) * 100).toFixed(1),
          )
        : 0,
    cacheHits,
    winners: Object.fromEntries(winners),
    providerFails: Object.fromEntries(providerFails),
    errorLevel50: Object.fromEntries(errorLevel50),
    retries,
  };
}

export function readLogFiles(filePaths) {
  const lines = [];
  for (const filePath of filePaths) {
    lines.push(...readFileSync(filePath, "utf8").split(/\r?\n/));
  }
  return lines;
}

export function collectLogFiles(directory) {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".log"))
    .map((name) => join(directory, name))
    .sort();
}

function main() {
  const args = process.argv.slice(2);
  const files =
    args.length > 0
      ? args.filter((arg) => !arg.startsWith("--"))
      : collectLogFiles(join(process.cwd(), "data", "logs"));
  if (files.length === 0) {
    process.stderr.write("No log files found. Pass paths as arguments.\n");
    process.exit(1);
  }
  const stats = analyzeLogs(readLogFiles(files));
  const { audioUrlMs, metadataMs, firstFrameDelayMs } = stats;
  const fmt = (s) =>
    s.count === 0
      ? "n/a"
      : `n=${s.count} avg=${s.avg}ms p50=${s.p50} p90=${s.p90} p95=${s.p95} p99=${s.p99} max=${s.max}`;
  console.log(`=== Rhapsod log-stats ===`);
  if (stats.period) {
    console.log(`Período: ${stats.period.from} → ${stats.period.to}`);
  }
  console.log(
    `Líneas: ${stats.parsedCount} parseadas, ${stats.skipped} descartadas`,
  );
  console.log(`Sesiones de playback: ${stats.playbackSessions}`);
  console.log(`audioUrlMs: ${fmt(audioUrlMs)}`);
  console.log(`metadataMs: ${fmt(metadataMs)}`);
  console.log(`firstFrameDelayMs: ${fmt(firstFrameDelayMs)}`);
  console.log(
    `Cache hit: ${stats.cacheHits.hit}/${stats.cacheHits.hit + stats.cacheHits.miss} (${stats.cacheHitRate}%)`,
  );
  console.log(`Winners: ${JSON.stringify(stats.winners)}`);
  console.log(`Falls por provider: ${JSON.stringify(stats.providerFails)}`);
  console.log(`Reintentos (yt-dlp client fallback): ${stats.retries}`);
  console.log(`Errores level:50: ${JSON.stringify(stats.errorLevel50)}`);
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  (process.argv[1]?.endsWith("log-stats.mjs") &&
    import.meta.url.endsWith("log-stats.mjs"));
if (isMain) {
  main();
}
