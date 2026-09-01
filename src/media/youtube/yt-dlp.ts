import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";

import type { MinimalLogger } from "../../observability/logger.js";
import { noopLogger } from "../../observability/logger.js";
import { UserError } from "../../lib/user-error.js";
import type { SearchMetrics } from "../../observability/metrics.js";
import { parseMediaInput, type YoutubeResource } from "../media-input.js";
import { rankYoutubeCandidatesScored } from "./search-ranking.js";
import type { TimeoutConfig } from "../../lib/timeout-config.js";
import { fetchInnertubePlayerAudioUrl } from "./innertube-player.js";
import {
  searchInnertubeMusicVideos,
  searchInnertubeVideos,
} from "./innertube-search.js";

const MAX_BUFFER_BYTES = 8 * 1024 * 1024;
const DAEMON_TIMEOUT_MS = 8_000;
const SEARCH_CACHE_TTL_MS = 60 * 60 * 1000;
const SEARCH_CACHE_MAX_ENTRIES = 500;
const ABORT_GRACE_MS = 3_000;
const AUDIO_FORMAT_SELECTOR = "251/bestaudio[acodec!=none]/bestaudio";
const PREFETCH_BATCH_SIZE = 10;

export const YTDLP_ABORT_ERROR = "yt-dlp job aborted";

export const YTDLP_PLAYER_CLIENTS = ["web_safari", "web_embedded"] as const;
export type YoutubePlayerClient = (typeof YTDLP_PLAYER_CLIENTS)[number];

export interface YtDlpExecutor {
  run(
    argumentsList: readonly string[],
    timeoutMs: number,
    priority?: YtDlpJobPriority,
    signal?: AbortSignal,
    playerClient?: YoutubePlayerClient,
  ): Promise<string>;
}

export type YtDlpJobPriority = "metadata" | "playback";
interface QueuedJob<Input, Output> {
  readonly input: Input;
  readonly reject: (error: unknown) => void;
  readonly resolve: (output: Output) => void;
  readonly signal?: AbortSignal;
}

export interface YtDlpExecutorOptions {
  readonly maxConcurrentJobs?: number;
  readonly maxQueuedJobs?: number;
}

const MAX_QUEUED_JOBS = 8;
const MAX_CONCURRENT_JOBS = Math.min(
  4,
  Math.max(2, availableParallelism() - 1),
);

export class YtDlpJobQueue<Input, Output> {
  readonly #metadata: Array<QueuedJob<Input, Output>> = [];
  readonly #playback: Array<QueuedJob<Input, Output>> = [];
  #running = 0;
  #metadataRunning = 0;
  #queued = 0;
  #totalRuns = 0;
  readonly #maxConcurrentJobs: number;
  readonly #maxQueuedJobs: number;

  constructor(
    private readonly execute: (
      input: Input,
      signal?: AbortSignal,
    ) => Promise<Output>,
    options: YtDlpExecutorOptions = {},
  ) {
    this.#maxConcurrentJobs = Math.max(
      1,
      options.maxConcurrentJobs ?? MAX_CONCURRENT_JOBS,
    );
    this.#maxQueuedJobs = Math.max(1, options.maxQueuedJobs ?? MAX_QUEUED_JOBS);
  }

  run(
    input: Input,
    priority: YtDlpJobPriority,
    signal?: AbortSignal,
  ): Promise<Output> {
    return new Promise<Output>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error(YTDLP_ABORT_ERROR));
        return;
      }
      const jobs = priority === "playback" ? this.#playback : this.#metadata;
      if (this.#queued >= this.#maxQueuedJobs) {
        reject(
          new UserError(
            "El bot está saturado de búsquedas: probá de nuevo en unos segundos.",
          ),
        );
        return;
      }
      jobs.push(
        signal === undefined
          ? { input, reject, resolve }
          : { input, reject, resolve, signal },
      );
      this.#queued++;
      void this.#drain();
    });
  }

  async #drain(): Promise<void> {
    if (this.#running >= this.#maxConcurrentJobs) return;
    const playbackJob = this.#playback.shift();
    const isMetadata = playbackJob === undefined;
    const job =
      playbackJob ??
      (this.#metadataRunning <
      (this.#maxConcurrentJobs > 1 ? this.#maxConcurrentJobs - 1 : 1)
        ? this.#metadata.shift()
        : undefined);
    if (!job) return;
    this.#queued--;
    if (job.signal?.aborted) {
      job.reject(new Error(YTDLP_ABORT_ERROR));
      void this.#drain();
      return;
    }
    this.#running++;
    if (isMetadata) this.#metadataRunning++;
    this.#totalRuns++;
    try {
      job.resolve(await this.execute(job.input, job.signal));
    } catch (error) {
      job.reject(error);
    } finally {
      if (isMetadata) this.#metadataRunning--;
      this.#running--;
      void this.#drain();
    }
  }

  metrics(): { active: number; queued: number; totalRuns: number } {
    return {
      active: Math.max(0, this.#running),
      queued: Math.max(0, this.#queued),
      totalRuns: this.#totalRuns,
    };
  }
}

export interface YoutubeTrackMetadata {
  readonly audioUrl?: string;
  readonly durationSeconds?: number;
  readonly fallbackSources?: readonly string[];
  readonly id: string;
  readonly title: string;
  readonly webpageUrl: string;
}

export interface YoutubeSearchCandidate extends YoutubeTrackMetadata {
  readonly channel?: string;
  readonly categories?: readonly string[];
  readonly liveStatus?: string;
  readonly viewCount?: number;
  readonly channelVerified?: boolean;
}

interface YtDlpJson {
  duration?: number;
  entries?: YtDlpJson[];
  id?: string;
  title?: string;
  channel?: string;
  categories?: string[];
  live_status?: string;
  view_count?: number;
  channel_is_verified?: boolean | null;
  playlist_count?: number;
  webpage_url?: string;
  url?: string;
  requested_downloads?: Array<{ url?: string }>;
}

export interface PlaylistExpansion {
  readonly total?: number;
  readonly tracks: readonly YoutubeTrackMetadata[];
}

export class SystemYtDlpExecutor implements YtDlpExecutor {
  readonly #jobs: YtDlpJobQueue<
    {
      argumentsList: readonly string[];
      playerClient?: YoutubePlayerClient;
      timeoutMs: number;
    },
    string
  >;
  readonly #logger: MinimalLogger;

  constructor(
    private readonly binaryPath: string,
    private readonly cookiesPath?: string,
    options: YtDlpExecutorOptions = {},
    logger?: MinimalLogger,
    private readonly extraExtractorArgs?: string,
  ) {
    this.#logger = logger ?? noopLogger;
    this.#jobs = new YtDlpJobQueue(
      async ({ argumentsList, playerClient, timeoutMs }, signal) => {
        const ytDlpArguments = buildYtDlpArguments(
          argumentsList,
          this.cookiesPath,
          playerClient ?? "web_safari",
          this.extraExtractorArgs,
        );
        const { file, args } = buildYtDlpCommand(
          this.binaryPath,
          ytDlpArguments,
        );
        return runYtDlpCommand(
          file,
          args,
          signal === undefined ? { timeoutMs } : { signal, timeoutMs },
          this.#logger,
        );
      },
      options,
    );
  }

  async run(
    argumentsList: readonly string[],
    timeoutMs: number,
    priority: YtDlpJobPriority = "metadata",
    signal?: AbortSignal,
    playerClient?: YoutubePlayerClient,
  ): Promise<string> {
    return this.#jobs.run(
      playerClient === undefined
        ? { argumentsList, timeoutMs }
        : { argumentsList, playerClient, timeoutMs },
      priority,
      signal,
    );
  }

  metrics(): { active: number; queued: number; totalRuns: number } {
    return this.#jobs.metrics();
  }
}

interface RunYtDlpOptions {
  readonly abortGraceMs?: number;
  readonly maxBufferBytes?: number;
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
}

export function runYtDlpCommand(
  file: string,
  args: readonly string[],
  options: RunYtDlpOptions,
  logger: MinimalLogger = noopLogger,
): Promise<string> {
  const startedAt = Date.now();
  logger.debug({ file, args }, "yt-dlp: spawning process");
  return new Promise<string>((resolve, reject) => {
    const child = spawn(file, [...args], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let stderr = "";
    let settled = false;

    const settleFailure = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      options.signal?.removeEventListener("abort", onAbort);
      child.kill("SIGTERM");
      const killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }, options.abortGraceMs ?? ABORT_GRACE_MS);
      killTimer.unref();
      logger.warn(
        { err: error, durationMs: Date.now() - startedAt },
        "yt-dlp: command failed",
      );
      reject(error);
    };

    const onAbort = (): void => {
      settleFailure(new Error(YTDLP_ABORT_ERROR));
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    const timeoutTimer = setTimeout(() => {
      settleFailure(new Error(`yt-dlp timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs);
    timeoutTimer.unref();

    child.stdout.on("data", (chunk: Buffer) => {
      totalBytes += chunk.byteLength;
      if (totalBytes > (options.maxBufferBytes ?? MAX_BUFFER_BYTES)) {
        settleFailure(
          new Error("yt-dlp output exceeded the maximum buffer size"),
        );
        child.kill("SIGKILL");
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-8_192);
    });
    child.on("error", (error) => settleFailure(error));
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      options.signal?.removeEventListener("abort", onAbort);
      if (code === 0) {
        logger.debug(
          { durationMs: Date.now() - startedAt },
          "yt-dlp: command completed",
        );
        resolve(Buffer.concat(chunks).toString("utf8"));
        return;
      }
      const detail = stderr.trim();
      reject(
        new Error(
          `yt-dlp exited with code ${code ?? "unknown"}${detail ? `: ${detail}` : ""}`,
        ),
      );
    });
  });
}

export class YoutubeResolver {
  readonly name = "youtube";

  readonly #searchCache = new Map<
    string,
    {
      readonly candidates: readonly YoutubeTrackMetadata[];
      readonly expiresAt: number;
    }
  >();
  readonly #searchInFlight = new Map<
    string,
    Promise<readonly YoutubeTrackMetadata[]>
  >();

  readonly #logger: MinimalLogger;
  readonly #onSearchMetrics: ((metrics: SearchMetrics) => void) | undefined;
  readonly #timeouts: TimeoutConfig | undefined;
  readonly #daemonUrl: string | undefined;
  readonly #daemonFetch: typeof fetch;

  constructor(
    private readonly executor: YtDlpExecutor,
    logger?: MinimalLogger,
    options?: {
      daemonFetch?: typeof fetch;
      daemonUrl?: string;
      onSearchMetrics?: (metrics: SearchMetrics) => void;
      timeouts?: TimeoutConfig;
    },
  ) {
    this.#logger = logger ?? noopLogger;
    this.#onSearchMetrics = options?.onSearchMetrics;
    this.#timeouts = options?.timeouts;
    this.#daemonUrl = options?.daemonUrl;
    this.#daemonFetch = options?.daemonFetch ?? fetch;
  }

  async getTrack(resource: YoutubeResource): Promise<YoutubeTrackMetadata> {
    if (resource.type !== "video")
      throw new Error("A playlist cannot be resolved as one track");
    const raw = await this.executor.run(
      [
        "--dump-single-json",
        "--no-playlist",
        "--no-warnings",
        "--ignore-no-formats",
        "--skip-download",
        youtubeUrl(resource.id),
      ],
      this.#timeouts?.metadata ?? 30_000,
    );
    return parseTrackResponse(raw);
  }

  getTrackFromUrl(url: string): Promise<YoutubeTrackMetadata> {
    return this.#getTrackFromUrl(url);
  }

  async search(
    query: string,
    expectedDurationSeconds?: number,
    expectedTitle?: string,
  ): Promise<YoutubeTrackMetadata> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) throw new Error("YouTube search cannot be empty");
    const match = await this.#searchOnce(
      normalizedQuery,
      expectedDurationSeconds,
      expectedTitle,
    );
    if (match) return match;
    const shortened = normalizedQuery.split(/\s+/).slice(0, -1).join(" ");
    if (shortened) {
      const retry = await this.#searchOnce(
        shortened,
        expectedDurationSeconds,
        expectedTitle,
      );
      if (retry) return retry;
    }
    throw new Error("No encontré una coincidencia confiable en YouTube");
  }

  async searchMany(
    query: string,
    expectedDurationSeconds?: number,
    limit = 5,
    expectedTitle?: string,
  ): Promise<readonly YoutubeTrackMetadata[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) throw new Error("YouTube search cannot be empty");
    const ranked = await this.#searchCandidates(
      normalizedQuery,
      expectedDurationSeconds,
      expectedTitle,
    );
    if (ranked.length === 0) {
      throw new Error("No encontré una coincidencia confiable en YouTube");
    }
    return ranked.slice(0, limit);
  }

  async #searchOnce(
    query: string,
    expectedDurationSeconds?: number,
    expectedTitle?: string,
  ): Promise<YoutubeTrackMetadata | undefined> {
    const ranked = await this.#searchCandidates(
      query,
      expectedDurationSeconds,
      expectedTitle,
    );
    if (ranked.length === 0) return undefined;
    const [selected, ...fallbacks] = ranked;
    return Object.assign(
      {},
      selected,
      fallbacks.length === 0
        ? {}
        : {
            fallbackSources: fallbacks.map((candidate) => candidate.webpageUrl),
          },
    );
  }

  async #searchCandidates(
    query: string,
    expectedDurationSeconds?: number,
    expectedTitle?: string,
  ): Promise<readonly YoutubeTrackMetadata[]> {
    const cacheKey = `${expectedDurationSeconds ?? 0}|${expectedTitle ?? ""}|${query}`;
    const cached = this.#searchCache.get(cacheKey);
    if (cached !== undefined) {
      if (cached.expiresAt > Date.now()) return cached.candidates;
      this.#searchCache.delete(cacheKey);
    }
    const inFlight = this.#searchInFlight.get(cacheKey);
    if (inFlight !== undefined) return inFlight;
    const request = this.#fetchSearchCandidates(
      query,
      expectedDurationSeconds,
      expectedTitle,
      cacheKey,
    );
    this.#searchInFlight.set(cacheKey, request);
    try {
      return await request;
    } finally {
      if (this.#searchInFlight.get(cacheKey) === request) {
        this.#searchInFlight.delete(cacheKey);
      }
    }
  }

  async #fetchSearchCandidates(
    query: string,
    expectedDurationSeconds: number | undefined,
    expectedTitle: string | undefined,
    cacheKey: string,
  ): Promise<readonly YoutubeTrackMetadata[]> {
    const searchStartedAt = Date.now();
    const candidates =
      (await this.#searchViaInnertube(query)) ??
      (await this.#searchViaYtDlp(query));
    const scored = rankYoutubeCandidatesScored(
      query,
      candidates,
      expectedDurationSeconds,
      expectedTitle,
    );
    if (scored.length > 0) {
      const top = scored[0]!;
      this.#logger.debug(
        {
          query,
          selectedId: top.candidate.id,
          selectedTitle: top.candidate.title,
          score: top.score,
          breakdown: top.breakdown,
          candidatesCount: candidates.length,
          rankedCount: scored.length,
        },
        "Search ranking: selected candidate",
      );
      this.#onSearchMetrics?.({
        query,
        winnerScore: top.score,
        topScores: scored.slice(0, 3).map((s) => s.score),
        candidatesCount: candidates.length,
        rankedCount: scored.length,
        durationMs: Date.now() - searchStartedAt,
      });
    }
    const ranked = scored.map((item) => item.candidate);
    this.#searchCache.set(cacheKey, {
      candidates: ranked,
      expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
    });
    if (this.#searchCache.size > SEARCH_CACHE_MAX_ENTRIES) {
      const oldest = this.#searchCache.keys().next().value;
      if (oldest !== undefined) this.#searchCache.delete(oldest);
    }
    return ranked;
  }

  async #searchViaInnertube(
    query: string,
  ): Promise<readonly YoutubeSearchCandidate[] | undefined> {
    // Generic YouTube search is more reliable for 403 (datacenter IP)
    // Music search is kept as fallback for queries like "poland" where generic returns travel
    const results = await searchInnertubeVideos(query);
    if (results.length > 0) {
      const hasMusicLike = results.some(
        (r) =>
          /official|audio|lyrics|topic/i.test(r.title) ||
          /topic|official/i.test(r.channel ?? ""),
      );
      if (!hasMusicLike) {
        const musicResults = await searchInnertubeMusicVideos(query);
        if (musicResults.length > 0) {
          return musicResults.map((result) => ({
            ...(result.durationSeconds === undefined
              ? {}
              : { durationSeconds: result.durationSeconds }),
            ...(result.channel === undefined ? {} : { channel: result.channel }),
            id: result.id,
            title: result.title,
            webpageUrl: `https://www.youtube.com/watch?v=${result.id}`,
          }));
        }
      }
      return results.map((result) => ({
        ...(result.durationSeconds === undefined
          ? {}
          : { durationSeconds: result.durationSeconds }),
        ...(result.channel === undefined ? {} : { channel: result.channel }),
        id: result.id,
        title: result.title,
        webpageUrl: `https://www.youtube.com/watch?v=${result.id}`,
      }));
    }
    return undefined;
  }

  async #searchViaYtDlp(
    query: string,
  ): Promise<readonly YoutubeSearchCandidate[]> {
    const raw = await this.executor.run(
      [
        "--dump-single-json",
        "--flat-playlist",
        "--playlist-end",
        "5",
        "--no-warnings",
        `ytsearch5:${query}`,
      ],
      this.#timeouts?.search ?? 30_000,
    );
    return (parseResponse(raw).entries ?? [])
      .filter((entry) => entry.id && entry.title)
      .map((entry) => parseSearchCandidate(entry));
  }

  async expandPlaylist(
    resource: YoutubeResource,
    limit: number,
  ): Promise<PlaylistExpansion> {
    if (resource.type !== "playlist")
      throw new Error("A video cannot be expanded as a playlist");
    const raw = await this.executor.run(
      [
        "--flat-playlist",
        "--dump-single-json",
        "--playlist-end",
        String(limit),
        "--no-warnings",
        youtubePlaylistUrl(resource.id),
      ],
      this.#timeouts?.playlist ?? 45_000,
    );
    const response = parseResponse(raw);
    return {
      ...(typeof response.playlist_count === "number"
        ? { total: response.playlist_count }
        : {}),
      tracks: (response.entries ?? [])
        .filter((entry) => entry.id && entry.title)
        .map((entry) => parseSearchCandidate(entry)),
    };
  }

  async getAudioUrlFromUrl(url: string, signal?: AbortSignal): Promise<string> {
    const startedAt = Date.now();

    const fastPathUrl = await this.#tryInnertubeFastPath(url, signal);
    if (fastPathUrl !== undefined) {
      this.#logger.info(
        { winner: "innertube-android-vr", durationMs: Date.now() - startedAt },
        "Audio URL resolved",
      );
      return fastPathUrl;
    }

    const daemonUrl = await this.#tryDaemonResolve(url, signal);
    if (daemonUrl !== undefined) {
      this.#logger.info(
        { winner: "yt-dlp-daemon", durationMs: Date.now() - startedAt },
        "Audio URL resolved",
      );
      return daemonUrl;
    }

    // Try web_embedded first (least bot-checked from datacenter IPs, no PO token
    // needed, no JS runtime for the n-challenge). Fall back to web_safari if the
    // URL is not embeddable.
    const clients: YoutubePlayerClient[] = ["web_embedded", "web_safari"];
    let lastError: unknown = new Error("yt-dlp did not return an audio URL");

    for (const playerClient of clients) {
      if (signal?.aborted) break;
      try {
        const audioUrl = await this.executor
          .run(
            [
              "--get-url",
              "--format",
              AUDIO_FORMAT_SELECTOR,
              "--no-playlist",
              "--no-warnings",
              url,
            ],
            this.#timeouts?.audioUrl ?? 30_000,
            "playback",
            signal,
            playerClient,
          )
          .then((output) => {
            const trimmed = output.trim().split(/\r?\n/, 1)[0];
            if (!trimmed || !trimmed.startsWith("https://"))
              throw new Error("yt-dlp did not return an HTTPS audio URL");
            return trimmed;
          });
        this.#logger.info(
          {
            winner: playerClient,
            durationMs: Date.now() - startedAt,
            attemptCount: clients.indexOf(playerClient) + 1,
          },
          "Audio URL resolved",
        );
        return audioUrl;
      } catch (error) {
        lastError = error;
        this.#logger.debug(
          { playerClient, err: error },
          "Audio URL attempt failed, trying next client",
        );
      }
    }

    if (signal?.aborted) {
      throw new Error(YTDLP_ABORT_ERROR);
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  async #tryInnertubeFastPath(
    url: string,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    if (signal?.aborted) return undefined;
    const media = parseMediaInput(url);
    if (media.kind !== "youtube" || media.resource.type !== "video") {
      return undefined;
    }
    return fetchInnertubePlayerAudioUrl(media.resource.id, {
      ...(signal === undefined ? {} : { signal }),
    });
  }

  async #tryDaemonResolve(
    url: string,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    if (this.#daemonUrl === undefined || signal?.aborted) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DAEMON_TIMEOUT_MS);
    timer.unref();
    const combinedSignal =
      signal === undefined
        ? controller.signal
        : AbortSignal.any([signal, controller.signal]);
    try {
      const response = await this.#daemonFetch(
        `${this.#daemonUrl}/resolve?url=${encodeURIComponent(url)}`,
        { signal: combinedSignal },
      );
      if (!response.ok) return undefined;
      const body = (await response.json()) as { readonly url?: string };
      if (typeof body.url === "string" && /^https:\/\//i.test(body.url)) {
        return body.url;
      }
      return undefined;
    } catch {
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  async invalidateAudioUrl(url: string): Promise<boolean> {
    if (this.#daemonUrl === undefined) return false;
    try {
      const response = await this.#daemonFetch(
        `${this.#daemonUrl}/invalidate?url=${encodeURIComponent(url)}`,
      );
      if (!response.ok) return false;
      const body = (await response.json()) as { readonly invalidated?: boolean };
      return body.invalidated === true;
    } catch {
      return false;
    }
  }

  async prefetchAudioUrls(
    urls: readonly string[],
    signal?: AbortSignal,
  ): Promise<readonly (string | undefined)[]> {
    const batchSize = PREFETCH_BATCH_SIZE;
    const results: Array<string | undefined> = [];
    for (let i = 0; i < urls.length; i++) {
      results.push(undefined);
    }
    for (let i = 0; i < urls.length; i += batchSize) {
      if (signal?.aborted) break;
      const batch = urls.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map((url) =>
          this.getAudioUrlFromUrl(url, signal).catch(() => undefined),
        ),
      );
      for (let j = 0; j < batchResults.length; j++) {
        const result = batchResults[j]!;
        if (result.status === "fulfilled" && result.value !== undefined) {
          results[i + j] = result.value;
        }
      }
    }
    return results;
  }

  async #getTrackFromUrl(url: string): Promise<YoutubeTrackMetadata> {
    const raw = await this.executor.run(
      [
        "--dump-single-json",
        "--no-playlist",
        "--no-warnings",
        "--ignore-no-formats",
        "--skip-download",
        url,
      ],
      this.#timeouts?.metadata ?? 30_000,
    );
    return parseTrackResponse(raw);
  }
}

export function buildYtDlpArguments(
  argumentsList: readonly string[],
  cookiesPath?: string,
  playerClient: YoutubePlayerClient = "web_safari",
  extraExtractorArgs?: string,
): string[] {
  const extractorArgs = [
    `youtube:player_client=${playerClient}`,
    ...(extraExtractorArgs ? [extraExtractorArgs] : []),
  ].join(" ");

  return [
    ...(cookiesPath ? ["--cookies", cookiesPath] : []),
    "--js-runtimes",
    "node",
    "--remote-components",
    "ejs:github",
    "--extractor-retries",
    "1",
    "--extractor-args",
    extractorArgs,
    ...argumentsList,
  ];
}

export function buildYtDlpCommand(
  binaryPath: string,
  argumentsList: readonly string[],
  platform: NodeJS.Platform = process.platform,
): { readonly args: readonly string[]; readonly file: string } {
  if (platform === "linux") {
    // Let playback win the CPU when a resolution runs while music is playing.
    return { file: "nice", args: ["-n", "10", binaryPath, ...argumentsList] };
  }
  return { file: binaryPath, args: argumentsList };
}

function parseResponse(raw: string): YtDlpJson {
  try {
    return JSON.parse(raw) as YtDlpJson;
  } catch {
    throw new Error("yt-dlp returned invalid JSON");
  }
}

function parseTrackResponse(raw: string | YtDlpJson): YoutubeSearchCandidate {
  const response = typeof raw === "string" ? parseResponse(raw) : raw;
  if (!response.id || !response.title)
    throw new Error("yt-dlp returned incomplete video metadata");
  const resolvedAudioUrl = audioUrl(response);
  return {
    ...(resolvedAudioUrl === undefined ? {} : { audioUrl: resolvedAudioUrl }),
    ...(response.duration === undefined
      ? {}
      : { durationSeconds: response.duration }),
    id: response.id,
    title: response.title,
    webpageUrl: response.webpage_url ?? youtubeUrl(response.id),
    ...(response.channel ? { channel: response.channel } : {}),
    ...(response.categories ? { categories: response.categories } : {}),
    ...(response.live_status ? { liveStatus: response.live_status } : {}),
    ...(typeof response.view_count === "number"
      ? { viewCount: response.view_count }
      : {}),
    ...(response.channel_is_verified === true ? { channelVerified: true } : {}),
  };
}

function parseSearchCandidate(raw: YtDlpJson): YoutubeSearchCandidate {
  const metadata = parseTrackResponse(raw);
  return {
    ...(metadata.durationSeconds === undefined
      ? {}
      : { durationSeconds: metadata.durationSeconds }),
    id: metadata.id,
    title: metadata.title,
    webpageUrl: metadata.webpageUrl,
    ...(metadata.channel ? { channel: metadata.channel } : {}),
    ...(metadata.categories ? { categories: metadata.categories } : {}),
    ...(metadata.liveStatus ? { liveStatus: metadata.liveStatus } : {}),
  };
}

function audioUrl(response: YtDlpJson): string | undefined {
  const value = response.requested_downloads?.[0]?.url ?? response.url;
  return value?.startsWith("https://") ? value : undefined;
}

function youtubeUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

function youtubePlaylistUrl(playlistId: string): string {
  return `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`;
}
