export interface Summary {
  count: number;
  avg: number | undefined;
  p50: number | undefined;
  p90: number | undefined;
  p95: number | undefined;
  p99: number | undefined;
  max: number | undefined;
}

export interface PrefetchStats {
  audioUrlTimings: number;
  withStatus: number;
  missingStatus: number;
  groups: Record<string, Summary>;
}

export interface LogStats {
  parsedCount: number;
  skipped: number;
  period: { from: string; to: string } | undefined;
  playbackSessions: number;
  playbackTimings: number;
  audioUrlMs: Summary;
  metadataMs: Summary;
  firstFrameDelayMs: Summary;
  cacheHitRate: number;
  cacheHits: { hit: number; miss: number };
  winners: Record<string, number>;
  providerFails: Record<string, number>;
  errorLevel50: Record<string, number>;
  retries: number;
  prefetch: PrefetchStats;
}

export interface CliArgs {
  help: boolean;
  files: string[];
  sinceMs?: number;
  untilMs?: number;
  error?: string;
}

export function parseLogLine(line: string): Record<string, unknown> | undefined;
export function parseIsoTime(value: string): number | undefined;
export function parseCliArgs(argv: string[]): CliArgs;
export function filterLinesByTime(
  lines: string[],
  sinceMs?: number,
  untilMs?: number,
): { lines: string[]; discarded: number };
export function classifyPrefetchStatus(value: unknown): string | undefined;
export function analyzeLogs(lines: string[]): LogStats;
export function formatStats(
  stats: LogStats,
  options?: {
    sinceMs?: number;
    untilMs?: number;
    discardedByTime?: number;
  },
): string;
export function readLogFiles(filePaths: string[]): string[];
export function collectLogFiles(directory: string): string[];
