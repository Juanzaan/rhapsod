#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

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

const LOW_SAMPLE_THRESHOLD = 20;

export function parseLogLine(line) {
  try {
    const parsed = JSON.parse(line);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function parseIsoTime(value) {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? undefined : time;
}

export function parseCliArgs(argv) {
  const args = [...argv];
  const result = { help: false, files: [] };
  if (args.includes("--help")) {
    result.help = true;
    return result;
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--since" || arg === "--until") {
      const value = args[i + 1];
      if (value === undefined) {
        return {
          ...result,
          error: `Missing value for ${arg}. Usage: --${arg.slice(2)} <ISO-8601>`,
        };
      }
      const ms = parseIsoTime(value);
      if (ms === undefined) {
        return {
          ...result,
          error: `Invalid ISO-8601 date for ${arg}: "${value}"`,
        };
      }
      if (arg === "--since") result.sinceMs = ms;
      else result.untilMs = ms;
      i++;
      continue;
    }
    if (arg.startsWith("--")) {
      return { ...result, error: `Unknown option: ${arg}` };
    }
    result.files.push(arg);
  }
  if (result.sinceMs !== undefined && result.untilMs !== undefined) {
    if (result.sinceMs > result.untilMs) {
      return { ...result, error: "--since must not be later than --until" };
    }
  }
  return result;
}

export function filterLinesByTime(lines, sinceMs, untilMs) {
  if (sinceMs === undefined && untilMs === undefined) {
    return { lines, discarded: 0 };
  }
  const filtered = [];
  let discarded = 0;
  for (const line of lines) {
    const record = parseLogLine(line);
    if (record === undefined) {
      filtered.push(line);
      continue;
    }
    if (typeof record.time !== "number") {
      filtered.push(line);
      continue;
    }
    if (sinceMs !== undefined && record.time < sinceMs) {
      discarded++;
      continue;
    }
    if (untilMs !== undefined && record.time > untilMs) {
      discarded++;
      continue;
    }
    filtered.push(line);
  }
  return { lines: filtered, discarded };
}

const PREFETCH_GROUP_MAP = {
  hit: "ready",
  "in-flight": "in-flight",
  miss: "miss",
  "not-applicable": "not-applicable",
  unknown: "unknown",
};

export function classifyPrefetchStatus(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return `other:${String(value)}`;
  const mapped = PREFETCH_GROUP_MAP[value];
  return mapped ?? `other:${sanitizeOtherValue(value)}`;
}

function sanitizeOtherValue(value) {
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length === 0) return "(vacío)";
  return cleaned.length > 40 ? `${cleaned.slice(0, 40)}…` : cleaned;
}

function sanitizeErrorKey(message) {
  return String(message)
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[url]")
    .replace(/cookie[s]?[:=]\s*\S+/gi, "cookie=[redacted]")
    .replace(/po_token[s]?[:=]\s*\S+/gi, "po_token=[redacted]")
    .replace(/token[s]?[:=]\s*\S+/gi, "token=[redacted]")
    .replace(/authorization[s]?[:=]\s*\S+/gi, "authorization=[redacted]")
    .replace(/refresh_token[:=]\s*\S+/gi, "refresh_token=[redacted]");
}

export function analyzeLogs(lines) {
  const audioUrlMs = [];
  const metadataMs = [];
  const firstFrameDelayMs = [];
  const cacheHits = { hit: 0, miss: 0 };
  const winners = new Map();
  const providerFails = new Map();
  const errorLevel50 = new Map();
  const prefetchGroups = new Map();
  let skipped = 0;
  let parsedCount = 0;
  let retries = 0;
  let playbackSessions = 0;
  let playbackTimings = 0;
  let audioUrlTimings = 0;
  let audioUrlTimingsWithPrefetch = 0;
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
      if (record.stage === "audio-url") {
        audioUrlTimings++;
        const group = classifyPrefetchStatus(record.prefetchStatus);
        if (group === undefined) {
          // Missing prefetchStatus: tolerated, no group assigned.
        } else {
          audioUrlTimingsWithPrefetch++;
          if (!prefetchGroups.has(group)) prefetchGroups.set(group, []);
          if (typeof record.durationMs === "number") {
            prefetchGroups.get(group).push(record.durationMs);
          }
        }
      }
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
      const key = sanitizeErrorKey(record.msg);
      errorLevel50.set(key, (errorLevel50.get(key) ?? 0) + 1);
    }
  }

  const period =
    Number.isFinite(start) && Number.isFinite(end)
      ? {
          from: new Date(start).toISOString(),
          to: new Date(end).toISOString(),
        }
      : undefined;

  const prefetch = {
    audioUrlTimings,
    withStatus: audioUrlTimingsWithPrefetch,
    missingStatus: audioUrlTimings - audioUrlTimingsWithPrefetch,
    groups: Object.fromEntries(
      [...prefetchGroups.entries()]
        .map(([key, values]) => [key, summarize(values)])
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  };

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
            ((cacheHits.hit / (cacheHits.hit + cacheHits.miss)) * 100).toFixed(
              1,
            ),
          )
        : 0,
    cacheHits,
    winners: Object.fromEntries(winners),
    providerFails: Object.fromEntries(providerFails),
    errorLevel50: Object.fromEntries(errorLevel50),
    retries,
    prefetch,
  };
}

function fmtSummary(s) {
  if (s.count === 0) return "n/a";
  const low = s.count < LOW_SAMPLE_THRESHOLD ? " (baja confianza)" : "";
  return `n=${s.count} avg=${s.avg} p50=${s.p50} p90=${s.p90} p95=${s.p95} p99=${s.p99} max=${s.max}${low}`;
}

export function formatStats(stats, options = {}) {
  const { sinceMs, untilMs, discardedByTime } = options;
  const lines = [];
  lines.push("=== Rhapsod log-stats ===");
  if (stats.period) {
    lines.push(`Período: ${stats.period.from} -> ${stats.period.to}`);
  }
  if (sinceMs !== undefined || untilMs !== undefined) {
    const since = sinceMs === undefined ? "(inicio)" : new Date(sinceMs).toISOString();
    const until = untilMs === undefined ? "(fin)" : new Date(untilMs).toISOString();
    lines.push(
      `Filtro temporal (inclusivo): since=${since} until=${until} (${discardedByTime ?? 0} líneas descartadas)`,
    );
  }
  lines.push(
    `Líneas: ${stats.parsedCount} parseadas, ${stats.skipped} inválidas`,
  );
  lines.push(`Sesiones de playback: ${stats.playbackSessions}`);
  lines.push(`Timings de playback: ${stats.playbackTimings}`);
  lines.push(`audioUrlMs (sesión): ${fmtSummary(stats.audioUrlMs)}`);
  lines.push(`firstFrameDelay: ${fmtSummary(stats.firstFrameDelayMs)}`);
  lines.push(`metadataMs: ${fmtSummary(stats.metadataMs)}`);
  lines.push(
    `Cache: ${stats.cacheHits.hit} hit / ${stats.cacheHits.miss} miss (${stats.cacheHitRate}%)`,
  );
  lines.push(`Winners: ${JSON.stringify(stats.winners)}`);
  lines.push(`Falls por provider: ${JSON.stringify(stats.providerFails)}`);
  lines.push(`Reintentos (yt-dlp client fallback): ${stats.retries}`);
  lines.push(`Errores level:50: ${JSON.stringify(stats.errorLevel50)}`);
  lines.push("");
  lines.push("--- Prefetch (por prefetchStatus, latencia de resolución) ---");
  lines.push(
    `Timings audio-url: ${stats.prefetch.audioUrlTimings} | con status: ${stats.prefetch.withStatus} | sin status: ${stats.prefetch.missingStatus}`,
  );
  const groupNames = Object.keys(stats.prefetch.groups);
  if (groupNames.length === 0) {
    lines.push("  (sin grupos con prefetchStatus)");
  }
  for (const name of groupNames) {
    lines.push(`  ${name}: ${fmtSummary(stats.prefetch.groups[name])}`);
  }
  return lines.join("\n");
}

export function readLogFiles(filePaths) {
  const lines = [];
  for (const filePath of filePaths) {
    let content;
    try {
      content = readFileSync(filePath, "utf8");
    } catch (error) {
      const code =
        typeof error?.code === "string" ? error.code : "UNKNOWN";
      const name = filePath.split(/[\\/]/).pop() ?? filePath;
      const wrapped = new Error(
        code === "ENOENT"
          ? `Archivo de log no encontrado: ${name}`
          : `No se pudo leer el archivo de log: ${name}`,
      );
      wrapped.code = code;
      throw wrapped;
    }
    lines.push(...content.split(/\r?\n/));
  }
  return lines;
}

export function collectLogFiles(directory) {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".log"))
    .map((name) => join(directory, name))
    .sort();
}

const USAGE = `Usage: log-stats.mjs [--since <ISO-8601>] [--until <ISO-8601>] [<log-file> ...]

Options:
  --since <ISO-8601>   Analyze lines with time >= since (inclusive).
  --until <ISO-8601>   Analyze lines with time <= until (inclusive).
  --help               Show this help.

With no file arguments, collects *.log from ./data/logs.
Timestamps are compared as absolute epoch values (UTC); Z and numeric
offsets are both accepted. If --since is later than --until the script
fails before reading any file.`;

function main() {
  const parsed = parseCliArgs(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(0);
  }
  if (parsed.error !== undefined) {
    process.stderr.write(`${parsed.error}\n\n${USAGE}\n`);
    process.exit(1);
  }
  const files =
    parsed.files.length > 0
      ? parsed.files
      : collectLogFiles(join(process.cwd(), "data", "logs"));
  if (files.length === 0) {
    process.stderr.write(
      "No log files found. Pass paths as arguments.\n\n" + USAGE + "\n",
    );
    process.exit(1);
  }
  let raw;
  try {
    raw = readLogFiles(files);
  } catch (error) {
    process.stderr.write(
      `Error: ${error instanceof Error ? error.message : "Error de lectura de logs"}\n`,
    );
    process.exit(1);
  }
  const { lines, discarded } = filterLinesByTime(
    raw,
    parsed.sinceMs,
    parsed.untilMs,
  );
  const stats = analyzeLogs(lines);
  process.stdout.write(
    formatStats(stats, {
      sinceMs: parsed.sinceMs,
      untilMs: parsed.untilMs,
      discardedByTime: discarded,
    }) + "\n",
  );
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  (process.argv[1]?.endsWith("log-stats.mjs") &&
    import.meta.url.endsWith("log-stats.mjs"));
if (isMain) {
  main();
}