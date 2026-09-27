import type { AudioPlayerMetrics } from "../audio/audio-player.js";
import { TICK_LATENESS_BOUNDS_MS } from "../audio/frame-scheduler.js";
import type {
  PlaybackEndReason,
  PlaybackKpis,
} from "../application/playback-controller.js";
import type { DaemonHealthSnapshot } from "../media/youtube/daemon-health.js";
import type { MetricsCounters } from "./metrics.js";

// Seconds. Starts under a second are the goal; the long tail covers slow
// resolutions up to the 90 s resolve watchdog.
const LATENCY_BUCKETS = [0.1, 0.25, 0.5, 1, 2, 4, 8, 16, 32, 64];
// Seconds. The gapless target is under 40 ms; 320 ms is today's prebuffer.
const GAP_BUCKETS = [
  0.01, 0.02, 0.04, 0.08, 0.16, 0.32, 0.64, 1.28, 2.56, 5.12,
];
// LUFS and dBTP of what plays sent, for tuning the loudness chain around its
// -14 LUFS default and -1.5 dBFS limiter ceiling.
const DELIVERED_LOUDNESS_BUCKETS = [
  -30, -26, -23, -20, -18, -16, -15, -14, -13, -12, -10,
];
const DELIVERED_PEAK_BUCKETS = [-6, -3, -2, -1.5, -1, -0.5, 0, 0.5, 1];
const TICK_LATENESS_BUCKETS = TICK_LATENESS_BOUNDS_MS.map((ms) => ms / 1_000);

class Histogram {
  readonly #buckets: readonly number[];
  readonly #counts: number[];
  #sum = 0;
  #count = 0;

  constructor(buckets: readonly number[]) {
    this.#buckets = buckets;
    this.#counts = buckets.map(() => 0);
  }

  /** Adds per-bucket counts (one per bound plus the open-ended bucket). */
  addCounts(counts: readonly number[], sum: number): void {
    let cumulative = 0;
    this.#buckets.forEach((_bound, index) => {
      cumulative += counts[index] ?? 0;
      this.#counts[index]! += cumulative;
    });
    this.#count += counts.reduce((total, count) => total + count, 0);
    this.#sum += sum;
  }

  observe(value: number): void {
    this.#sum += value;
    this.#count++;
    this.#buckets.forEach((bound, index) => {
      if (value <= bound) this.#counts[index]!++;
    });
  }

  lines(name: string, help: string): string[] {
    return [
      `# HELP ${name} ${help}`,
      `# TYPE ${name} histogram`,
      ...this.#buckets.map(
        (bound, index) =>
          `${name}_bucket{le="${bound}"} ${this.#counts[index]}`,
      ),
      `${name}_bucket{le="+Inf"} ${this.#count}`,
      `${name}_sum ${round(this.#sum)}`,
      `${name}_count ${this.#count}`,
    ];
  }
}

/** Per-play outcomes and latency since the process started. */
export class PlaybackMetrics {
  readonly #plays = new Map<PlaybackEndReason, number>();
  readonly #startDelay = new Histogram(LATENCY_BUCKETS);
  readonly #handoffGap = new Histogram(LATENCY_BUCKETS);
  readonly #interTrackGap = new Histogram(GAP_BUCKETS);
  readonly #commandToFirstAudio = new Histogram(LATENCY_BUCKETS);
  readonly #handoffs = { cold: 0, prewarmed: 0 };
  readonly #tickLateness = new Histogram(TICK_LATENESS_BUCKETS);
  readonly #deliveredLoudness = new Histogram(DELIVERED_LOUDNESS_BUCKETS);
  readonly #deliveredPeak = new Histogram(DELIVERED_PEAK_BUCKETS);
  #clockSlips = 0;
  #underruns = 0;
  #rebuffers = 0;

  record(
    reason: PlaybackEndReason,
    metrics: AudioPlayerMetrics,
    kpis: PlaybackKpis | undefined,
  ): void {
    this.#plays.set(reason, (this.#plays.get(reason) ?? 0) + 1);
    this.#underruns += metrics.underruns;
    this.#rebuffers += metrics.rebufferEvents;
    const delivered = metrics.delivered;
    if (delivered?.integratedLufs !== undefined)
      this.#deliveredLoudness.observe(delivered.integratedLufs);
    if (delivered?.truePeakDbtp !== undefined)
      this.#deliveredPeak.observe(delivered.truePeakDbtp);
    const timing = metrics.clockTiming;
    if (timing !== undefined) {
      this.#tickLateness.addCounts(
        timing.latenessCounts,
        timing.latenessSumMs / 1_000,
      );
      this.#clockSlips += timing.clockSlips;
    }
    if (kpis === undefined) return;
    if (kpis.startDelayMs !== undefined)
      this.#startDelay.observe(kpis.startDelayMs / 1_000);
    if (kpis.handoffGapMs !== undefined)
      this.#handoffGap.observe(kpis.handoffGapMs / 1_000);
    if (kpis.interTrackGapMs !== undefined)
      this.#interTrackGap.observe(kpis.interTrackGapMs / 1_000);
    if (kpis.commandToFirstAudioMs !== undefined)
      this.#commandToFirstAudio.observe(kpis.commandToFirstAudioMs / 1_000);
    if (!kpis.coldStart) {
      if (kpis.prewarmed) this.#handoffs.prewarmed++;
      else this.#handoffs.cold++;
    }
  }

  lines(): string[] {
    const reasons: PlaybackEndReason[] = [
      "completed",
      "skipped",
      "stopped",
      "error",
    ];
    return [
      "# HELP rhapsod_plays_total Finished plays by how they ended.",
      "# TYPE rhapsod_plays_total counter",
      ...reasons.map(
        (reason) =>
          `rhapsod_plays_total{reason="${reason}"} ${this.#plays.get(reason) ?? 0}`,
      ),
      ...this.#startDelay.lines(
        "rhapsod_play_start_delay_seconds",
        "From picking a track to its first audio frame.",
      ),
      ...this.#handoffGap.lines(
        "rhapsod_handoff_gap_seconds",
        "Silence between one track's end and the next track's first frame.",
      ),
      ...this.#interTrackGap.lines(
        "rhapsod_inter_track_gap_seconds",
        "Silence from one track's last audio frame to the next track's first.",
      ),
      ...this.#commandToFirstAudio.lines(
        "rhapsod_command_to_first_audio_seconds",
        "From a request to its track's first audio frame, on a cold start.",
      ),
      "# HELP rhapsod_handoffs_total Track changes without idle, by whether the next stream was prewarmed.",
      "# TYPE rhapsod_handoffs_total counter",
      `rhapsod_handoffs_total{prewarmed="true"} ${this.#handoffs.prewarmed}`,
      `rhapsod_handoffs_total{prewarmed="false"} ${this.#handoffs.cold}`,
      "# HELP rhapsod_underruns_total Audio frames sent as silence because the source fell behind.",
      "# TYPE rhapsod_underruns_total counter",
      `rhapsod_underruns_total ${this.#underruns}`,
      ...this.#tickLateness.lines(
        "rhapsod_frame_tick_lateness_seconds",
        "How late each 20 ms audio tick fired against its deadline.",
      ),
      ...this.#deliveredLoudness.lines(
        "rhapsod_delivered_loudness_lufs",
        "Integrated BS.1770 loudness each play sent, before the !volume gain.",
      ),
      ...this.#deliveredPeak.lines(
        "rhapsod_delivered_true_peak_dbtp",
        "BS.1770 true peak each play sent, before the !volume gain.",
      ),
      "# HELP rhapsod_clock_slips_total Audio ticks more than a frame late, where the clock dropped its base.",
      "# TYPE rhapsod_clock_slips_total counter",
      `rhapsod_clock_slips_total ${this.#clockSlips}`,
      "# HELP rhapsod_rebuffers_total Times playback paused to refill the buffer.",
      "# TYPE rhapsod_rebuffers_total counter",
      `rhapsod_rebuffers_total ${this.#rebuffers}`,
    ];
  }
}

export interface PrometheusSnapshot {
  readonly counters: MetricsCounters;
  readonly memoryRssBytes: number;
  readonly playback: PlaybackMetrics;
  readonly uptimeSeconds: number;
  readonly version: string;
  /** Undefined when no yt-dlp daemon is configured. */
  readonly ytdlpDaemon?: DaemonHealthSnapshot | undefined;
}

/** Prometheus text exposition format 0.0.4. */
export function renderPrometheus(snapshot: PrometheusSnapshot): string {
  const { counters } = snapshot;
  const counter = (name: string, help: string, value: number): string[] => [
    `# HELP ${name} ${help}`,
    `# TYPE ${name} counter`,
    `${name} ${value}`,
  ];
  const gauge = (name: string, help: string, value: number): string[] => [
    `# HELP ${name} ${help}`,
    `# TYPE ${name} gauge`,
    `${name} ${value}`,
  ];
  return [
    "# HELP rhapsod_build_info Running version.",
    "# TYPE rhapsod_build_info gauge",
    `rhapsod_build_info{version="${snapshot.version.replace(/["\\\n]/g, "")}"} 1`,
    ...gauge(
      "rhapsod_uptime_seconds",
      "Seconds since the process started.",
      Math.round(snapshot.uptimeSeconds),
    ),
    ...gauge(
      "process_resident_memory_bytes",
      "Resident memory of the bot process.",
      snapshot.memoryRssBytes,
    ),
    ...snapshot.playback.lines(),
    "# HELP rhapsod_audio_url_cache_total Audio URL cache lookups by result.",
    "# TYPE rhapsod_audio_url_cache_total counter",
    `rhapsod_audio_url_cache_total{result="hit"} ${counters.cacheHits}`,
    `rhapsod_audio_url_cache_total{result="miss"} ${counters.cacheMisses}`,
    "# HELP rhapsod_prefetch_total Next-track URL prefetch state when the track started.",
    "# TYPE rhapsod_prefetch_total counter",
    `rhapsod_prefetch_total{status="hit"} ${counters.prefetchHits}`,
    `rhapsod_prefetch_total{status="in-flight"} ${counters.prefetchInFlight}`,
    `rhapsod_prefetch_total{status="miss"} ${counters.prefetchMisses}`,
    ...counter(
      "rhapsod_search_queries_total",
      "Searches run.",
      counters.searchQueriesTotal,
    ),
    ...counter(
      "rhapsod_errors_total",
      "Playback errors recorded.",
      counters.totalErrors,
    ),
    ...counter(
      "rhapsod_ytdlp_runs_total",
      "yt-dlp processes started.",
      counters.ytdlpTotalRuns,
    ),
    ...gauge(
      "rhapsod_ytdlp_active_jobs",
      "yt-dlp processes running now.",
      counters.ytdlpActiveJobs,
    ),
    ...gauge(
      "rhapsod_ytdlp_queued_jobs",
      "yt-dlp jobs waiting for a slot.",
      counters.ytdlpQueuedJobs,
    ),
    ...(snapshot.ytdlpDaemon === undefined
      ? []
      : [
          ...gauge(
            "rhapsod_ytdlp_daemon_up",
            "0 while the yt-dlp daemon is failing and resolves fall back to spawning yt-dlp.",
            snapshot.ytdlpDaemon.state === "failing" ? 0 : 1,
          ),
          ...counter(
            "rhapsod_ytdlp_daemon_fallbacks_total",
            "Audio URL resolves that fell back from the daemon to spawning yt-dlp.",
            snapshot.ytdlpDaemon.fallbacksTotal,
          ),
        ]),
    "",
  ].join("\n");
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
