export type AudioUrlSource = "prefetch" | "cache-load" | "inline-resolve";

/**
 * Tracks whether a prefetch was useful at the moment of playback request.
 *
 * - "hit":        entry from "prefetch" origin, fresh when requested.
 * - "in-flight":  entry from "prefetch" origin, still pending resolution.
 * - "miss":       track was in queue but no fresh entry existed in #prepared.
 *                 Applies regardless of origin — the cache missed the playback need.
 * - "not-applicable": origin is "cache-load" or "inline-resolve"; prefetch tracking
 *                     does not apply.
 */
export type PrefetchStatus = "hit" | "in-flight" | "miss" | "not-applicable";

export type ErrorCategory =
  "auth" | "timeout" | "rate-limit" | "not-found" | "playback" | "unknown";

export interface NormalizedError {
  readonly category: ErrorCategory;
  readonly message: string;
}

const MAX_ERROR_MESSAGE_LENGTH = 120;

const MAX_SEARCH_METRICS = 200;

export interface SearchMetrics {
  readonly query: string;
  readonly winnerScore: number;
  readonly topScores: readonly number[];
  readonly candidatesCount: number;
  readonly rankedCount: number;
  readonly durationMs: number;
}

function percentile(arr: readonly number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(
    Math.max(0, Math.ceil((sorted.length * p) / 100) - 1),
    sorted.length - 1,
  );
  return sorted[idx]!;
}

const ERROR_PATTERNS: ReadonlyArray<{
  readonly category: ErrorCategory;
  readonly pattern: RegExp;
}> = [
  {
    category: "auth",
    pattern: /sign in|cookies|login.?required|authentication/i,
  },
  { category: "timeout", pattern: /timed? ?out|abort|ETIMEDED|ECONNRESET/i },
  { category: "rate-limit", pattern: /429|rate.?limit|too many/i },
  { category: "not-found", pattern: /404|not.?found|Video.*unavailable/i },
  { category: "playback", pattern: /playback|streaming|underrun|stall/i },
];

export function sanitizeUrl(input: string): string {
  return input
    .replace(/https?:\/\/[^\s"'<>]+/g, "[url]")
    .replace(/\/[a-zA-Z0-9_./-]{8,}/g, (match) => {
      if (match.startsWith("http")) return match;
      return "[path]";
    });
}

export function sanitizeSensitive(input: string): string {
  let result = input;
  result = result.replace(
    /cookie[s]?[:=]\s*"[^"]*"|cookie[s]?[:=]\s*[^\s;,"']+/gi,
    "cookie=[redacted]",
  );
  result = result.replace(
    /po_token[s]?[:=]\s*"[^"]*"|po_token[s]?[:=]\s*[^\s;,"']+/gi,
    "po_token=[redacted]",
  );
  result = result.replace(
    /token[s]?[:=]\s*"[^"]*"|token[s]?[:=]\s*[^\s;,"']+/gi,
    "token=[redacted]",
  );
  result = result.replace(
    /authorization[s]?[:=]\s*"[^"]*"|authorization[s]?[:=]\s*[^\s;,"']+/gi,
    "authorization=[redacted]",
  );
  result = result.replace(/header[s]?[:=]\s*\{[^}]+\}/gi, "headers=[redacted]");
  return result;
}

export function normalizeError(error: unknown): NormalizedError {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "unknown error";
  const sanitized = sanitizeUrl(sanitizeSensitive(raw));

  let category: ErrorCategory = "unknown";
  for (const { category: cat, pattern } of ERROR_PATTERNS) {
    if (pattern.test(raw)) {
      category = cat;
      break;
    }
  }

  const message =
    sanitized.length > MAX_ERROR_MESSAGE_LENGTH
      ? `${sanitized.slice(0, MAX_ERROR_MESSAGE_LENGTH - 1)}…`
      : sanitized;

  return { category, message };
}

export interface TrackTiming {
  readonly trackId: string;
  readonly stage: "metadata" | "audio-url";
  readonly durationMs: number;
  readonly audioUrlSource?: AudioUrlSource;
  readonly cacheHit?: boolean;
  readonly prefetchStatus?: PrefetchStatus;
}

export interface MetricsCounters {
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly prefetchHits: number;
  readonly prefetchInFlight: number;
  readonly prefetchMisses: number;
  readonly searchQueriesTotal: number;
  readonly ytdlpActiveJobs: number;
  readonly ytdlpQueuedJobs: number;
  readonly ytdlpTotalRuns: number;
  readonly totalErrors: number;
}

interface MetricsError {
  readonly ts: number;
  readonly trackId: string;
  readonly normalized: NormalizedError;
}

export class MetricsCollector {
  readonly #timings: TrackTiming[] = [];
  readonly #errors: MetricsError[] = [];
  readonly #counters = new Map<string, number>();
  readonly #searchDurationsMs: number[] = [];
  readonly #searchScores: number[] = [];
  readonly #maxTimings: number;
  readonly #maxErrors: number;
  readonly #clock: () => number;

  constructor(options?: {
    maxTimings?: number;
    maxErrors?: number;
    clock?: () => number;
  }) {
    this.#maxTimings = options?.maxTimings ?? 100;
    this.#maxErrors = options?.maxErrors ?? 50;
    this.#clock = options?.clock ?? (() => Date.now());
  }

  recordTiming(timing: TrackTiming): void {
    this.#timings.push(timing);
    if (this.#timings.length > this.#maxTimings) {
      this.#timings.shift();
    }
  }

  recordError(trackId: string, error: unknown): void {
    this.#errors.push({
      ts: this.#clock(),
      trackId,
      normalized: normalizeError(error),
    });
    if (this.#errors.length > this.#maxErrors) {
      this.#errors.shift();
    }
    this.#counters.set(
      "totalErrors",
      (this.#counters.get("totalErrors") ?? 0) + 1,
    );
  }

  recordSearchMetrics(metrics: SearchMetrics): void {
    this.#counters.set(
      "searchQueriesTotal",
      (this.#counters.get("searchQueriesTotal") ?? 0) + 1,
    );
    this.#searchDurationsMs.push(metrics.durationMs);
    if (this.#searchDurationsMs.length > MAX_SEARCH_METRICS) {
      this.#searchDurationsMs.shift();
    }
    this.#searchScores.push(metrics.winnerScore);
    if (this.#searchScores.length > MAX_SEARCH_METRICS) {
      this.#searchScores.shift();
    }
  }

  increment(name: string): void {
    this.#counters.set(name, (this.#counters.get(name) ?? 0) + 1);
  }

  decrement(name: string): void {
    this.#counters.set(name, Math.max(0, (this.#counters.get(name) ?? 0) - 1));
  }

  setGauge(name: string, value: number): void {
    this.#counters.set(name, value);
  }

  counters(): MetricsCounters {
    return {
      cacheHits: this.#counters.get("cacheHits") ?? 0,
      cacheMisses: this.#counters.get("cacheMisses") ?? 0,
      prefetchHits: this.#counters.get("prefetchHits") ?? 0,
      prefetchInFlight: this.#counters.get("prefetchInFlight") ?? 0,
      prefetchMisses: this.#counters.get("prefetchMisses") ?? 0,
      searchQueriesTotal: this.#counters.get("searchQueriesTotal") ?? 0,
      totalErrors: this.#counters.get("totalErrors") ?? 0,
      ytdlpActiveJobs: this.#counters.get("ytdlpActiveJobs") ?? 0,
      ytdlpQueuedJobs: this.#counters.get("ytdlpQueuedJobs") ?? 0,
      ytdlpTotalRuns: this.#counters.get("ytdlpTotalRuns") ?? 0,
    };
  }

  recentTimings(count = 20): readonly TrackTiming[] {
    return this.#timings.slice(-count);
  }

  recentErrors(count = 20): readonly MetricsError[] {
    return this.#errors.slice(-count);
  }

  formatStats(args: {
    readonly audioHealth?: {
      readonly firstFrameDelayMs?: number;
      readonly rebufferEvents: number;
      readonly underruns: number;
    };
    readonly current?: {
      readonly title: string;
      readonly durationSeconds?: number;
    };
    readonly loopMode: string;
    readonly queueLen: number;
    readonly tracksPlayed: number;
    readonly uptimeSec: number;
    readonly volume: number;
    readonly ytdlpActive: number;
    readonly ytdlpQueued: number;
  }): string {
    const c = this.counters();
    const hours = Math.floor(args.uptimeSec / 3_600);
    const minutes = Math.floor((args.uptimeSec % 3_600) / 60);
    const { rss } = process.memoryUsage();

    const cacheTotal = c.cacheHits + c.cacheMisses;
    const hitRate =
      cacheTotal > 0 ? ((c.cacheHits / cacheTotal) * 100).toFixed(1) : "0.0";

    const currentTitle = args.current
      ? truncateTitle(args.current.title, 40)
      : undefined;
    const durationStr =
      args.current?.durationSeconds !== undefined
        ? ` (${formatDuration(args.current.durationSeconds)})`
        : "";

    const searchTotal = this.#counters.get("searchQueriesTotal") ?? 0;
    const searchLines: string[] = [];
    if (searchTotal > 0) {
      const durP50 = percentile(this.#searchDurationsMs, 50);
      const durP90 = percentile(this.#searchDurationsMs, 90);
      const durP99 = percentile(this.#searchDurationsMs, 99);
      const scoreP50 = percentile(this.#searchScores, 50);
      const scoreP90 = percentile(this.#searchScores, 90);
      const scoreP99 = percentile(this.#searchScores, 99);
      searchLines.push(
        ``,
        `--- Búsquedas ---`,
        `Total: ${searchTotal} | Duración: p50=${durP50}ms p90=${durP90}ms p99=${durP99}ms`,
        `Score: p50=${scoreP50} p90=${scoreP90} p99=${scoreP99}`,
      );
    }

    const lines = [
      `=== Rhapsod Stats ===`,
      `Uptime: ${hours}h ${minutes}m | RSS: ${Math.round(rss / 1_048_576)} MB`,
      currentTitle
        ? `Actual: ${currentTitle}${durationStr} | Cola: ${args.queueLen} | Vol: ${args.volume}% | Loop: ${args.loopMode}`
        : `Nada reproduciéndose | Cola: ${args.queueLen} | Vol: ${args.volume}% | Loop: ${args.loopMode}`,
      `Reproducidas: ${args.tracksPlayed}`,
      ``,
      `--- Cache ---`,
      `Hits: ${c.cacheHits} | Misses: ${c.cacheMisses} (${hitRate}% hit rate)`,
      `Prefetch: ${c.prefetchHits} hit / ${c.prefetchInFlight} in-flight / ${c.prefetchMisses} miss`,
      ``,
      `--- yt-dlp ---`,
      `Activos: ${args.ytdlpActive} | En cola: ${args.ytdlpQueued} | Total: ${c.ytdlpTotalRuns}`,
      ...searchLines,
    ];

    if (args.audioHealth !== undefined) {
      const ah = args.audioHealth;
      const firstFrameStr =
        ah.firstFrameDelayMs !== undefined ? `${ah.firstFrameDelayMs}ms` : "-";
      lines.push(
        ``,
        `--- Audio ---`,
        `Inicio: ${firstFrameStr} | Underruns: ${ah.underruns} | Rebuffers: ${ah.rebufferEvents}`,
      );
    }

    return lines.join("\n");
  }

  formatDiag(): string {
    const recentErr = this.recentErrors(3);
    const recentTim = this.recentTimings(5);
    const lines = [
      `=== Diagnóstico ===`,
      ``,
      `--- Errores recientes (${recentErr.length}) ---`,
      ...(recentErr.length === 0
        ? ["  (ninguno)"]
        : recentErr.map(
            (e) => `  [${e.normalized.category}] ${e.normalized.message}`,
          )),
      ``,
      `--- Timings recientes (${recentTim.length}) ---`,
      ...(recentTim.length === 0
        ? ["  (ninguno)"]
        : recentTim.map(
            (t) =>
              `  ${t.trackId} | ${t.stage} ${t.durationMs}ms | src=${t.audioUrlSource ?? "?"} cache=${t.cacheHit ?? "?"} pf=${t.prefetchStatus ?? "?"}`,
          )),
    ];
    return lines.join("\n");
  }

  reset(): void {
    this.#timings.length = 0;
    this.#errors.length = 0;
    this.#searchDurationsMs.length = 0;
    this.#searchScores.length = 0;
    this.#counters.clear();
  }
}

function truncateTitle(title: string, maxLength: number): string {
  if (title.length <= maxLength) return title;
  return `${title.slice(0, maxLength - 1)}…`;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "?";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
