export interface Summary {
  count: number;
  avg: number;
  p50: number | undefined;
  p90: number | undefined;
  p95: number | undefined;
  p99: number | undefined;
  max: number | undefined;
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
}

export function parseLogLine(
  line: string,
): Record<string, unknown> | undefined;
export function analyzeLogs(lines: string[]): LogStats;
export function readLogFiles(filePaths: string[]): string[];
export function collectLogFiles(directory: string): string[];
