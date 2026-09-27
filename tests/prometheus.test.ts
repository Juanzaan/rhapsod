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
      commandToFirstAudioMs: 1_200,
      prewarmed: false,
      startDelayMs: 300,
    });
    playback.record("skipped", audio, {
      coldStart: false,
      handoffGapMs: 80,
      interTrackGapMs: 30,
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
    expect(text).toContain(
      'rhapsod_inter_track_gap_seconds_bucket{le="0.02"} 0',
    );
    expect(text).toContain(
      'rhapsod_inter_track_gap_seconds_bucket{le="0.04"} 1',
    );
    expect(text).toContain(
      'rhapsod_command_to_first_audio_seconds_bucket{le="2"} 1',
    );
    expect(text).toContain('rhapsod_handoffs_total{prewarmed="true"} 1');
    expect(text).toContain('rhapsod_handoffs_total{prewarmed="false"} 0');
    expect(text).toContain("rhapsod_underruns_total 9");
    expect(text).toContain("rhapsod_rebuffers_total 3");
  });
});

describe("PlaybackMetrics clock timing", () => {
  it("sums each play's tick lateness buckets and clock slips", () => {
    const playback = new PlaybackMetrics();
    const timing = (counts: number[], sumMs: number, slips: number) => ({
      ...audio,
      clockTiming: {
        clockSlips: slips,
        latenessCounts: counts,
        latenessSumMs: sumMs,
        maxLatenessMs: 70,
        ticks: counts.reduce((total, count) => total + count, 0),
      },
    });
    playback.record(
      "completed",
      timing([5, 0, 1, 0, 0, 0, 1], 80, 1),
      undefined,
    );
    playback.record("skipped", timing([2, 1, 0, 0, 0, 0, 0], 20, 0), undefined);
    playback.record("error", audio, undefined);

    const text = render(playback);
    expect(text).toContain(
      'rhapsod_frame_tick_lateness_seconds_bucket{le="0.001"} 7',
    );
    expect(text).toContain(
      'rhapsod_frame_tick_lateness_seconds_bucket{le="0.002"} 8',
    );
    expect(text).toContain(
      'rhapsod_frame_tick_lateness_seconds_bucket{le="0.05"} 9',
    );
    expect(text).toContain(
      'rhapsod_frame_tick_lateness_seconds_bucket{le="+Inf"} 10',
    );
    expect(text).toContain("rhapsod_frame_tick_lateness_seconds_sum 0.1");
    expect(text).toContain("rhapsod_clock_slips_total 1");
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

  it("exports the yt-dlp daemon state and fallbacks when a daemon is set", () => {
    const text = renderPrometheus({
      counters,
      memoryRssBytes: 1_000,
      playback: new PlaybackMetrics(),
      uptimeSeconds: 1,
      version: "4.0.0",
      ytdlpDaemon: {
        state: "failing",
        consecutiveFailures: 3,
        fallbacksTotal: 7,
      },
    });
    expect(text).toContain("rhapsod_ytdlp_daemon_up 0\n");
    expect(text).toContain("rhapsod_ytdlp_daemon_fallbacks_total 7\n");
  });

  it("omits the daemon series without a daemon", () => {
    expect(render(new PlaybackMetrics())).not.toContain("rhapsod_ytdlp_daemon");
  });
});
