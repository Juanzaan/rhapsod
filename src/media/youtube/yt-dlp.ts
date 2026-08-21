import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";

import type { YoutubeResource } from "../media-input.js";
import { rankYoutubeCandidatesAll } from "./search-ranking.js";

const MAX_BUFFER_BYTES = 8 * 1024 * 1024;
const SEARCH_CACHE_TTL_MS = 15 * 60 * 1000;
const SEARCH_CACHE_MAX_ENTRIES = 100;
const ABORT_GRACE_MS = 3_000;
const AUDIO_FORMAT_SELECTOR =
  "bestaudio[acodec!=none]/bestaudio/best[acodec!=none]";

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
  2,
  Math.max(1, availableParallelism() - 1),
);

export class YtDlpJobQueue<Input, Output> {
  readonly #metadata: Array<QueuedJob<Input, Output>> = [];
  readonly #playback: Array<QueuedJob<Input, Output>> = [];
  #running = 0;
  #metadataRunning = 0;
  #queued = 0;
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
          new Error(
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
}

interface YtDlpJson {
  duration?: number;
  entries?: YtDlpJson[];
  id?: string;
  title?: string;
  channel?: string;
  categories?: string[];
  live_status?: string;
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

  constructor(
    private readonly binaryPath: string,
    private readonly cookiesPath?: string,
    options: YtDlpExecutorOptions = {},
  ) {
    this.#jobs = new YtDlpJobQueue(
      async ({ argumentsList, playerClient, timeoutMs }, signal) => {
        const ytDlpArguments = buildYtDlpArguments(
          argumentsList,
          this.cookiesPath,
          playerClient ?? "web_safari",
        );
        const { file, args } = buildYtDlpCommand(
          this.binaryPath,
          ytDlpArguments,
        );
        return runYtDlpCommand(
          file,
          args,
          signal === undefined ? { timeoutMs } : { signal, timeoutMs },
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
): Promise<string> {
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

  constructor(private readonly executor: YtDlpExecutor) {}

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
      30_000,
    );
    return parseTrackResponse(raw);
  }

  getTrackFromUrl(url: string): Promise<YoutubeTrackMetadata> {
    return this.#getTrackFromUrl(url);
  }

  async search(
    query: string,
    expectedDurationSeconds?: number,
  ): Promise<YoutubeTrackMetadata> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) throw new Error("YouTube search cannot be empty");
    const match = await this.#searchOnce(
      normalizedQuery,
      expectedDurationSeconds,
    );
    if (match) return match;
    const shortened = normalizedQuery.split(/\s+/).slice(0, -1).join(" ");
    if (shortened) {
      const retry = await this.#searchOnce(shortened, expectedDurationSeconds);
      if (retry) return retry;
    }
    throw new Error("No encontré una coincidencia confiable en YouTube");
  }

  async searchMany(
    query: string,
    expectedDurationSeconds?: number,
    limit = 5,
  ): Promise<readonly YoutubeTrackMetadata[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) throw new Error("YouTube search cannot be empty");
    const ranked = await this.#searchCandidates(
      normalizedQuery,
      expectedDurationSeconds,
    );
    if (ranked.length === 0) {
      throw new Error("No encontré una coincidencia confiable en YouTube");
    }
    return ranked.slice(0, limit);
  }

  async #searchOnce(
    query: string,
    expectedDurationSeconds?: number,
  ): Promise<YoutubeTrackMetadata | undefined> {
    const ranked = await this.#searchCandidates(query, expectedDurationSeconds);
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
  ): Promise<readonly YoutubeTrackMetadata[]> {
    const cacheKey = `${expectedDurationSeconds ?? 0}|${query}`;
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
    cacheKey: string,
  ): Promise<readonly YoutubeTrackMetadata[]> {
    const raw = await this.executor.run(
      [
        "--dump-single-json",
        "--flat-playlist",
        "--playlist-end",
        "12",
        "--no-warnings",
        `ytsearch12:${query}`,
      ],
      30_000,
    );
    const candidates = (parseResponse(raw).entries ?? [])
      .filter((entry) => entry.id && entry.title)
      .map((entry) => parseSearchCandidate(entry));
    const ranked = rankYoutubeCandidatesAll(
      query,
      candidates,
      expectedDurationSeconds,
    );
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
      45_000,
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
    let lastError: unknown;
    for (const playerClient of YTDLP_PLAYER_CLIENTS) {
      try {
        const output = await this.executor.run(
          [
            "--get-url",
            "--format",
            AUDIO_FORMAT_SELECTOR,
            "--no-playlist",
            "--no-warnings",
            url,
          ],
          45_000,
          "playback",
          signal,
          playerClient,
        );
        const audioUrl = output.trim().split(/\r?\n/, 1)[0];
        if (!audioUrl || !audioUrl.startsWith("https://"))
          throw new Error("yt-dlp did not return an HTTPS audio URL");
        return audioUrl;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
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
      30_000,
    );
    return parseTrackResponse(raw);
  }
}

export function buildYtDlpArguments(
  argumentsList: readonly string[],
  cookiesPath?: string,
  playerClient: YoutubePlayerClient = "web_safari",
): string[] {
  return [
    ...(cookiesPath ? ["--cookies", cookiesPath] : []),
    "--js-runtimes",
    "node",
    "--remote-components",
    "ejs:github",
    "--extractor-retries",
    "1",
    "--extractor-args",
    `youtube:player_client=${playerClient}`,
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
