import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { YoutubeResource } from "../media-input.js";

const execFileAsync = promisify(execFile);
const MAX_BUFFER_BYTES = 2 * 1024 * 1024;

export interface YtDlpExecutor {
  run(argumentsList: readonly string[], timeoutMs: number): Promise<string>;
}

export interface YoutubeTrackMetadata {
  readonly durationSeconds?: number;
  readonly id: string;
  readonly title: string;
  readonly webpageUrl: string;
}

interface YtDlpJson {
  duration?: number;
  entries?: YtDlpJson[];
  id?: string;
  title?: string;
  webpage_url?: string;
}

export class SystemYtDlpExecutor implements YtDlpExecutor {
  constructor(
    private readonly binaryPath: string,
    private readonly cookiesPath?: string,
  ) {}

  async run(
    argumentsList: readonly string[],
    timeoutMs: number,
  ): Promise<string> {
    const ytDlpArguments = buildYtDlpArguments(argumentsList, this.cookiesPath);
    const { stdout } = await execFileAsync(this.binaryPath, ytDlpArguments, {
      maxBuffer: MAX_BUFFER_BYTES,
      timeout: timeoutMs,
      windowsHide: true,
    });
    return stdout;
  }
}

export class YoutubeResolver {
  constructor(private readonly executor: YtDlpExecutor) {}

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

  async search(query: string): Promise<YoutubeTrackMetadata> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) throw new Error("YouTube search cannot be empty");
    const raw = await this.executor.run(
      [
        "--dump-single-json",
        "--flat-playlist",
        "--playlist-end",
        "1",
        "--no-warnings",
        "--skip-download",
        `ytsearch1:${normalizedQuery}`,
      ],
      30_000,
    );
    const response = parseResponse(raw).entries?.[0];
    if (!response) throw new Error("yt-dlp returned no YouTube results");
    return parseTrackResponse(response);
  }

  async getAudioUrl(resource: YoutubeResource): Promise<string> {
    if (resource.type !== "video")
      throw new Error("A playlist must be expanded before playback");
    return this.getAudioUrlFromUrl(youtubeUrl(resource.id));
  }

  async getAudioUrlFromUrl(url: string): Promise<string> {
    const output = await this.executor.run(
      [
        "--get-url",
        "--format",
        "bestaudio[acodec!=none]/bestaudio",
        "--no-playlist",
        "--no-warnings",
        url,
      ],
      45_000,
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
    ...argumentsList,
  ];
}

function parseResponse(raw: string): YtDlpJson {
  try {
    return JSON.parse(raw) as YtDlpJson;
  } catch {
    throw new Error("yt-dlp returned invalid JSON");
  }
}

function parseTrackResponse(raw: string | YtDlpJson): YoutubeTrackMetadata {
  const response = typeof raw === "string" ? parseResponse(raw) : raw;
  if (!response.id || !response.title)
    throw new Error("yt-dlp returned incomplete video metadata");
  return {
    ...(response.duration === undefined
      ? {}
      : { durationSeconds: response.duration }),
    id: response.id,
    title: response.title,
    webpageUrl: response.webpage_url ?? youtubeUrl(response.id),
  };
}

function youtubeUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}
