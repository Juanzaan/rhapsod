import { describe, expect, it } from "vitest";

import {
  PlaybackMetrics,
  renderPrometheus,
} from "../src/observability/prometheus.js";

const audio = {
  bufferedBytes: 0,
  framesSent: 100,
  maxBufferedBytes: 0,
  rebufferEvents: 1,
  underruns: 3,
};

const counters = {
  cacheHits: 4,
  cacheMisses: 1,
  prefetchHits: 2,
  prefetchInFlight: 0,
  prefetchMisses: 1,
  searchQueriesTotal: 7,
  totalErrors: 0,
  ytdlpActiveJobs: 1,
  ytdlpQueuedJobs: 0,
  ytdlpTotalRuns: 9,
};

function render(playback: PlaybackMetrics): string {
  return renderPrometheus({
    counters,
    memoryRssBytes: 1_000,
    playback,
    uptimeSeconds: 12.4,
    version: "4.0.0",
  });
}

describe("PlaybackMetrics", () => {
  it("counts plays and fills cumulative latency buckets in seconds", () => {
    const playback = new PlaybackMetrics();
    playback.record("completed", audio, {
      coldStart: true,
      prewarmed: false,
      startDelayMs: 300,
    });
    playback.record("skipped", audio, {
      coldStart: false,
      handoffGapMs: 80,
      prewarmed: true,
      startDelayMs: 2_500,
    });
    playback.record("error", audio, undefined);

    const text = render(playback);
    expect(text).toContain('rhapsod_plays_total{reason="completed"} 1');
    expect(text).toContain('rhapsod_plays_total{reason="skipped"} 1');
    expect(text).toContain('rhapsod_plays_total{reason="error"} 1');
    expect(text).toContain(
      'rhapsod_play_start_delay_seconds_bucket{le="0.25"} 0',
    );
    expect(text).toContain(
      'rhapsod_play_start_delay_seconds_bucket{le="0.5"} 1',
    );
    expect(text).toContain('rhapsod_play_start_delay_seconds_bucket{le="4"} 2');
    expect(text).toContain(
      'rhapsod_play_start_delay_seconds_bucket{le="+Inf"} 2',
    );
    expect(text).toContain("rhapsod_play_start_delay_seconds_sum 2.8");
    expect(text).toContain('rhapsod_handoff_gap_seconds_bucket{le="0.1"} 1');
    expect(text).toContain('rhapsod_handoffs_total{prewarmed="true"} 1');
    expect(text).toContain('rhapsod_handoffs_total{prewarmed="false"} 0');
    expect(text).toContain("rhapsod_underruns_total 9");
    expect(text).toContain("rhapsod_rebuffers_total 3");
  });
});

describe("renderPrometheus", () => {
  it("writes valid exposition lines with a HELP and TYPE per family", () => {
    const text = render(new PlaybackMetrics());
    const lines = text.trimEnd().split("\n");
    const families = new Set<string>();
    for (const line of lines) {
      if (line.startsWith("# TYPE ")) {
        const [, , name, type] = line.split(" ");
        expect(["counter", "gauge", "histogram"]).toContain(type);
        expect(families.has(name!)).toBe(false);
        families.add(name!);
        continue;
      }
      if (line.startsWith("# HELP ")) continue;
      expect(line).toMatch(
        /^[a-z_][a-z0-9_]*(\{[a-z_]+="[^"]*"(,[a-z_]+="[^"]*")*\})? -?[0-9.e+]+$/,
      );
    }
    expect(text).toContain('rhapsod_build_info{version="4.0.0"} 1');
    expect(text).toContain('rhapsod_audio_url_cache_total{result="hit"} 4');
    expect(text).toContain("rhapsod_uptime_seconds 12");
    expect(text.endsWith("\n")).toBe(true);
  });
});
