import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AudioPlayer } from "../audio/audio-player.js";
import type { FfmpegPlaybackSession } from "../audio/ffmpeg-player.js";
import type { RhapsodOpusEncoder } from "../audio/opus-encoder.js";
import { parseArtistTitle } from "../media/lyrics.js";
import type { YoutubeTrackMetadata } from "../media/youtube/yt-dlp.js";
import { AUTOPLAY_UID, energyOfTitle } from "./autoplay-picker.js";
import { ListeningHistory } from "./listening-history.js";
import {
  YoutubePlaybackService,
  type YoutubePlaybackResolver,
} from "./youtube-playback-service.js";

/** A track in the synthetic or recorded catalog, with its YouTube mix. */
export interface AutoplayCatalogTrack {
  readonly id: string;
  readonly title: string;
  readonly durationSeconds: number;
  /** Ids in the order YouTube's "RD<id>" mix would list them. */
  readonly mix: readonly string[];
}

export interface AutoplayEvalFixture {
  readonly seedId: string;
  /** Plays already in the listening history before the session starts. */
  readonly history: readonly { readonly id: string; readonly times: number }[];
  readonly turns: number;
  readonly tracks: readonly AutoplayCatalogTrack[];
  /** Limits the evaluation test enforces; tighten them as autoplay improves. */
  readonly limits: {
    readonly maxRepeats: number;
    readonly maxArtistShare: number;
    readonly maxMeanEnergyJump: number;
    readonly minNewShare: number;
  };
}

export interface AutoplayEvalReport {
  readonly picks: readonly { readonly id: string; readonly title: string }[];
  /** Picks whose id already played within the last `REPEAT_WINDOW` plays. */
  readonly repeats: number;
  /** Largest share one artist holds in any `ARTIST_WINDOW` consecutive picks. */
  readonly maxArtistShare: number;
  /** Mean absolute change of title energy between consecutive tracks. */
  readonly meanEnergyJump: number;
  /** Share of picks the channel had never heard before the session. */
  readonly newShare: number;
  /** True when autoplay found nothing before reaching `turns`. */
  readonly ranDry: boolean;
}

const REPEAT_WINDOW = 20;
// How long a turn may take to start before autoplay counts as dry. Bounded
// by wall-clock time, not timer ticks: a tick is ~16 ms on Windows, where
// 500 ticks ran past vitest's 5 s test timeout.
const DRY_WAIT_MS = 500;
const ARTIST_WINDOW = 10;
const LISTENER_UID = "uid-eval";

/** Deterministic PRNG so a report is reproducible for a given seed. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Runs the real YoutubePlaybackService autoplay for `fixture.turns` picks,
 * with every track ending as completed, and measures the sequence.
 */
export async function runAutoplayEval(
  fixture: AutoplayEvalFixture,
  seed = 1,
): Promise<AutoplayEvalReport> {
  const byId = new Map(fixture.tracks.map((track) => [track.id, track]));
  const metadata = (id: string): YoutubeTrackMetadata => {
    const track = byId.get(id);
    if (track === undefined) throw new Error(`Unknown track ${id}`);
    return {
      durationSeconds: track.durationSeconds,
      id: track.id,
      title: track.title,
      webpageUrl: `https://www.youtube.com/watch?v=${track.id}`,
    };
  };
  const resolver: YoutubePlaybackResolver = {
    expandPlaylist: (resource) => {
      const mix = byId.get(resource.id.replace(/^RD/, ""))?.mix ?? [];
      return Promise.resolve({
        title: `Mix ${resource.id}`,
        tracks: mix.filter((id) => byId.has(id)).map(metadata),
      });
    },
    getAudioUrlFromUrl: () => Promise.resolve("https://media.example/audio"),
    getTrack: (resource) => Promise.resolve(metadata(resource.id)),
    getTrackFromUrl: () => Promise.reject(new Error("not in the catalog")),
    search: () => Promise.reject(new Error("not in the catalog")),
    searchMany: () => Promise.resolve([]),
  };

  const directory = mkdtempSync(join(tmpdir(), "rhapsod-autoplay-eval-"));
  const history = new ListeningHistory(join(directory, "history.json"));
  for (const entry of fixture.history) {
    const track = metadata(entry.id);
    for (let index = 0; index < entry.times; index++) {
      history.recordStart(LISTENER_UID, track);
      history.recordFinish(LISTENER_UID, track, true);
    }
  }
  const heardBefore = new Set(fixture.history.map((entry) => entry.id));

  const finishers: Array<() => void> = [];
  const player = {
    metrics: {
      bufferedBytes: 0,
      framesSent: 1,
      maxBufferedBytes: 0,
      rebufferEvents: 0,
      underruns: 0,
    },
    setVolume: () => undefined,
  } as unknown as AudioPlayer;
  const encoder = {
    encode: () => new Uint8Array(),
  } as unknown as RhapsodOpusEncoder;
  const service = new YoutubePlaybackService({
    autoplayProfile: history,
    autoplayRandom: seededRandom(seed),
    createPlayback: (): FfmpegPlaybackSession => ({
      done: new Promise<void>((resolve) => finishers.push(resolve)),
      player,
      stop: () => undefined,
    }),
    encoder,
    onPlaybackFinished: (track, _metrics, reason) => {
      history.recordFinish(
        track.requestedByUid ?? track.requestedBy,
        { id: track.id, title: track.title },
        reason === "completed",
      );
    },
    onPlaybackStarted: (track) => {
      history.recordStart(track.requestedByUid ?? track.requestedBy, {
        id: track.id,
        title: track.title,
      });
    },
    output: { sendVoiceFrame: () => undefined },
    // The catalog's mixes are the whole world: no live "related" lookups.
    relatedVideoId: () => Promise.resolve(undefined),
    resolver,
  });

  const picks: { id: string; title: string }[] = [];
  let ranDry = false;
  try {
    service.setAutoplay(true);
    await service.enqueue(
      `https://www.youtube.com/watch?v=${fixture.seedId}`,
      "Listener",
      LISTENER_UID,
    );
    let started = 0;
    while (picks.length < fixture.turns) {
      const wanted = started + 1;
      started = await waitForSessions(finishers, wanted);
      if (started < wanted) {
        ranDry = true;
        break;
      }
      const current = service.current;
      if (current?.requestedByUid === AUTOPLAY_UID) {
        picks.push({ id: current.id, title: current.title });
      }
      finishers[started - 1]?.();
    }
  } finally {
    service.stop();
    await history.flush().catch(() => undefined);
    rmSync(directory, { force: true, recursive: true });
  }
  return measure(fixture.seedId, byId, picks, heardBefore, ranDry);
}

async function waitForSessions(
  finishers: readonly unknown[],
  wanted: number,
): Promise<number> {
  const deadline = Date.now() + DRY_WAIT_MS;
  while (finishers.length < wanted && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return Math.min(finishers.length, wanted);
}

function measure(
  seedId: string,
  byId: ReadonlyMap<string, AutoplayCatalogTrack>,
  picks: readonly { id: string; title: string }[],
  heardBefore: ReadonlySet<string>,
  ranDry: boolean,
): AutoplayEvalReport {
  const sequence = [seedId, ...picks.map((pick) => pick.id)];
  let repeats = 0;
  sequence.forEach((id, index) => {
    const window = sequence.slice(Math.max(0, index - REPEAT_WINDOW), index);
    if (index > 0 && window.includes(id)) repeats++;
  });

  const artists = picks.map(
    (pick) => parseArtistTitle(pick.title).artist?.toLowerCase() ?? pick.id,
  );
  let maxArtistShare = 0;
  for (
    let start = 0;
    start + ARTIST_WINDOW <= artists.length || start === 0;
    start++
  ) {
    const window = artists.slice(start, start + ARTIST_WINDOW);
    if (window.length === 0) break;
    const counts = new Map<string, number>();
    for (const artist of window)
      counts.set(artist, (counts.get(artist) ?? 0) + 1);
    maxArtistShare = Math.max(
      maxArtistShare,
      Math.max(...counts.values()) / window.length,
    );
  }

  const titles = [byId.get(seedId)?.title ?? "", ...picks.map((p) => p.title)];
  let energyJump = 0;
  for (let index = 1; index < titles.length; index++) {
    energyJump += Math.abs(
      energyOfTitle(titles[index]!) - energyOfTitle(titles[index - 1]!),
    );
  }

  return {
    maxArtistShare: round(maxArtistShare),
    meanEnergyJump: round(
      titles.length > 1 ? energyJump / (titles.length - 1) : 0,
    ),
    newShare: round(
      picks.length === 0
        ? 0
        : picks.filter((pick) => !heardBefore.has(pick.id)).length /
            picks.length,
    ),
    picks,
    ranDry,
    repeats,
  };
}

export function formatAutoplayEval(report: AutoplayEvalReport): string {
  return [
    `Autoplay evaluation: ${report.picks.length} picks${report.ranDry ? " (ran dry)" : ""}`,
    `  repeats within ${REPEAT_WINDOW} plays: ${report.repeats}`,
    `  largest artist share in ${ARTIST_WINDOW} picks: ${report.maxArtistShare}`,
    `  mean energy jump: ${report.meanEnergyJump}`,
    `  new to the channel: ${report.newShare}`,
    ...report.picks.map((pick, index) => `  ${index + 1}. ${pick.title}`),
  ].join("\n");
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
