import { describe, expect, it } from "vitest";

import {
  MetricsCollector,
  type SearchMetrics,
} from "../src/observability/metrics.js";

function makeSearchMetrics(overrides?: Partial<SearchMetrics>): SearchMetrics {
  return {
    query: "test query",
    winnerScore: 80,
    topScores: [80, 60, 40],
    candidatesCount: 8,
    rankedCount: 5,
    durationMs: 500,
    ...overrides,
  };
}

describe("MetricsCollector — search metrics", () => {
  it("increments searchQueriesTotal on each recordSearchMetrics call", () => {
    const m = new MetricsCollector();
    expect(m.counters().searchQueriesTotal).toBe(0);

    m.recordSearchMetrics(makeSearchMetrics());
    m.recordSearchMetrics(makeSearchMetrics());

    const c = m.counters();
    expect(c.searchQueriesTotal).toBe(2);
  });

  it("stores durations and scores for percentile computation", () => {
    const m = new MetricsCollector();
    for (let i = 1; i <= 10; i++) {
      m.recordSearchMetrics(
        makeSearchMetrics({ durationMs: i * 100, winnerScore: i * 10 }),
      );
    }

    const output = m.formatStats({
      loopMode: "off",
      queueLen: 0,
      tracksPlayed: 0,
      uptimeSec: 100,
      volume: 80,
      ytdlpActive: 0,
      ytdlpQueued: 0,
    });

    expect(output).toContain("--- Búsquedas ---");
    expect(output).toContain("Total: 10");
    expect(output).toContain("Duración: p50=");
    expect(output).toContain("Score: p50=");
  });

  it("formatStats omits search section when no searches recorded", () => {
    const m = new MetricsCollector();
    const output = m.formatStats({
      loopMode: "off",
      queueLen: 0,
      tracksPlayed: 0,
      uptimeSec: 100,
      volume: 80,
      ytdlpActive: 0,
      ytdlpQueued: 0,
    });

    expect(output).not.toContain("--- Búsquedas ---");
  });

  it("computes correct percentiles for durations", () => {
    const m = new MetricsCollector();
    for (let i = 1; i <= 100; i++) {
      m.recordSearchMetrics(makeSearchMetrics({ durationMs: i }));
    }

    const output = m.formatStats({
      loopMode: "off",
      queueLen: 0,
      tracksPlayed: 0,
      uptimeSec: 100,
      volume: 80,
      ytdlpActive: 0,
      ytdlpQueued: 0,
    });

    expect(output).toContain("p50=50ms");
    expect(output).toContain("p90=90ms");
    expect(output).toContain("p99=99ms");
  });

  it("resets search metrics on reset()", () => {
    const m = new MetricsCollector();
    m.recordSearchMetrics(makeSearchMetrics());
    m.recordSearchMetrics(makeSearchMetrics());

    m.reset();

    const c = m.counters();
    expect(c.searchQueriesTotal).toBe(0);
  });

  it("caps stored search metrics at max (ring buffer)", () => {
    const m = new MetricsCollector();
    for (let i = 0; i < 250; i++) {
      m.recordSearchMetrics(makeSearchMetrics({ durationMs: i }));
    }

    const output = m.formatStats({
      loopMode: "off",
      queueLen: 0,
      tracksPlayed: 0,
      uptimeSec: 100,
      volume: 80,
      ytdlpActive: 0,
      ytdlpQueued: 0,
    });

    expect(output).toContain("Total: 250");
  });
});
