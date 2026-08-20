import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { YoutubeResource } from "../media-input.js";
import { parseMediaInput } from "../media-input.js";
import { rankYoutubeCandidatesAll } from "./search-ranking.js";

const execFileAsync = promisify(execFile);
const MAX_BUFFER_BYTES = 2 * 1024 * 1024;
const AUDIO_FORMAT_SELECTOR =
  "bestaudio[acodec!=none]/bestaudio/best[acodec!=none]";

export interface YtDlpExecutor {
  run(
    argumentsList: readonly string[],
    timeoutMs: number,
    priority?: YtDlpJobPriority,
  ): Promise<string>;
}

type YtDlpJobPriority = "metadata" | "playback";
interface QueuedJob<Input, Output> {
  readonly input: Input;
  readonly resolve: (output: Output) => void;
  readonly reject: (error: unknown) => void;
}

const MAX_QUEUED_JOBS = 8;
const MAX_CONCURRENT_JOBS = 2;

export class YtDlpJobQueue<Input, Output> {
  readonly #metadata: Array<QueuedJob<Input, Output>> = [];
  readonly #playback: Array<QueuedJob<Input, Output>> = [];
  #running = 0;

  constructor(private readonly execute: (input: Input) => Promise<Output>) {}

  run(input: Input, priority: YtDlpJobPriority): Promise<Output> {
    return new Promise<Output>((resolve, reject) => {
      const jobs = priority === "playback" ? this.#playback : this.#metadata;
      if (jobs.length >= MAX_QUEUED_JOBS) {
        reject(
          new Error(
            "El bot está saturado de búsquedas: probá de nuevo en unos segundos.",
          ),
        );
        return;
      }
      jobs.push({ input, reject, resolve });
      void this.#drain();
    });
  }

  async #drain(): Promise<void> {
    if (this.#running >= MAX_CONCURRENT_JOBS) return;
    if (this.#running > 0 && this.#playback.length === 0) return;
    const job =
      this.#playback.shift() ??
      (this.#running === 0 ? this.#metadata.shift() : undefined);
    if (!job) return;
    this.#running++;
    try {
      job.resolve(await this.execute(job.input));
    } catch (error) {
      job.reject(error);
    } finally {
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
    { argumentsList: readonly string[]; timeoutMs: number },
    string
  >;

  constructor(
    private readonly binaryPath: string,
    private readonly cookiesPath?: string,
  ) {
    this.#jobs = new YtDlpJobQueue(async ({ argumentsList, timeoutMs }) => {
      const ytDlpArguments = buildYtDlpArguments(
        argumentsList,
        this.cookiesPath,
      );
      const { file, args } = buildYtDlpCommand(this.binaryPath, ytDlpArguments);
      const { stdout } = await execFileAsync(file, [...args], {
        maxBuffer: MAX_BUFFER_BYTES,
        timeout: timeoutMs,
        windowsHide: true,
      });
      return stdout;
    });
  }

  async run(
    argumentsList: readonly string[],
    timeoutMs: number,
    priority: YtDlpJobPriority = "metadata",
  ): Promise<string> {
    return this.#jobs.run({ argumentsList, timeoutMs }, priority);
  }
}

export class YoutubeResolver {
  readonly name = "youtube";

  constructor(private readonly executor: YtDlpExecutor) {}

  match(input: string): boolean {
    try {
      return parseMediaInput(input).kind === "youtube";
    } catch {
      return false;
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.executor.run(["--version"], 5_000);
      return true;
    } catch {
      return false;
    }
  }

  async getTrack(resource: YoutubeResource): Promise<YoutubeTrackMetadata> {
    if (resource.type !== "video")
      throw new Error("A playlist cannot be resolved as one track");
    const raw = await this.executor.run(
      [
        "--dump-single-json",
        "--format",
        AUDIO_FORMAT_SELECTOR,
        "--no-playlist",
        "--no-warnings",
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
    return rankYoutubeCandidatesAll(query, candidates, expectedDurationSeconds);
  }

  async getAudioUrl(resource: YoutubeResource): Promise<string> {
    if (resource.type !== "video")
      throw new Error("A playlist must be expanded before playback");
    return this.getAudioUrlFromUrl(youtubeUrl(resource.id));
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

  async getAudioUrlFromUrl(url: string): Promise<string> {
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
    );
    const audioUrl = output.trim().split(/\r?\n/, 1)[0];
    if (!audioUrl || !audioUrl.startsWith("https://"))
      throw new Error("yt-dlp did not return an HTTPS audio URL");
    return audioUrl;
  }

  async #getTrackFromUrl(url: string): Promise<YoutubeTrackMetadata> {
    const raw = await this.executor.run(
      [
        "--dump-single-json",
        "--format",
        AUDIO_FORMAT_SELECTOR,
        "--no-playlist",
        "--no-warnings",
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
    "youtube:player_client=web_embedded",
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
