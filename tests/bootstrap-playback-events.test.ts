import { describe, expect, it, vi } from "vitest";

import type { AudioPlayerMetrics } from "../src/audio/audio-player.js";
import { AUTOPLAY_UID } from "../src/application/autoplay-picker.js";
import {
  TrackTimings,
  createPlaybackEvents,
} from "../src/bootstrap/playback-events.js";
import type { Track } from "../src/domain/track.js";

const PLAYER: AudioPlayerMetrics = {
  bufferedBytes: 0,
  framesSent: 100,
  maxBufferedBytes: 0,
  rebufferEvents: 0,
  underruns: 0,
};

function track(overrides: Partial<Track> = {}): Track {
  return {
    durationSeconds: 200,
    id: "abc",
    requestedBy: "Ana",
    requestedByUid: "uid-ana",
    source: "https://youtu.be/abc",
    title: "Artist - Song",
    ...overrides,
  };
}

function harness() {
  let started = false;
  const info = vi.fn();
  const listeningHistory = { recordFinish: vi.fn(), recordStart: vi.fn() };
  const songLibrary = { record: vi.fn() };
  const metrics = {
    increment: vi.fn<(name: string) => void>(),
    recordError: vi.fn(),
    recordTiming: vi.fn(),
  };
  const playbackMetrics = { record: vi.fn() };
  const sendChannelMessage = vi.fn<(text: string) => Promise<void>>(() =>
    Promise.resolve(),
  );
  const events = createPlaybackEvents({
    listeningHistory,
    logger: { debug: vi.fn(), error: vi.fn(), info, warn: vi.fn() },
    markStarted: () => {
      const first = !started;
      started = true;
      return first;
    },
    metrics,
    playbackMetrics,
    sendChannelMessage,
    songLibrary,
  });
  return {
    events,
    info,
    listeningHistory,
    metrics,
    playbackMetrics,
    sendChannelMessage,
    songLibrary,
  };
}

describe("createPlaybackEvents", () => {
  it("announces the first track differently from the rest and autoplay picks", async () => {
    const { events, sendChannelMessage } = harness();
    await events.onPlaybackStarted(track());
    await events.onPlaybackStarted(track({ title: "Other - Next" }));
    await events.onPlaybackStarted(
      track({ requestedByUid: AUTOPLAY_UID, title: "DJ - Pick" }),
    );
    expect(sendChannelMessage.mock.calls.map(([text]) => text)).toEqual([
      "Reproduciendo: Artist - Song",
      "Ahora: Other - Next",
      "Autoplay: DJ - Pick",
    ]);
  });

  it("records finite tracks in the library but not radio streams", async () => {
    const { events, listeningHistory, songLibrary } = harness();
    await events.onPlaybackStarted(track());
    const radio: Track = {
      id: "radio",
      requestedBy: "Ana",
      source: "https://radio.example/stream",
      title: "Radio X",
    };
    await events.onPlaybackStarted(radio);
    expect(songLibrary.record).toHaveBeenCalledTimes(1);
    expect(songLibrary.record).toHaveBeenCalledWith({
      artist: "Artist",
      id: "abc",
      source: "https://youtu.be/abc",
      title: "Artist - Song",
    });
    expect(listeningHistory.recordStart).toHaveBeenCalledTimes(2);
  });

  it("logs both timings with the session and forgets them afterwards", () => {
    const { events, info, listeningHistory, playbackMetrics } = harness();
    events.onTiming({ durationMs: 40, stage: "metadata", trackId: "abc" });
    events.onTiming({
      cacheHit: true,
      durationMs: 90,
      prefetchStatus: "hit",
      stage: "audio-url",
      trackId: "abc",
    });
    events.onPlaybackFinished(track(), PLAYER, "completed");
    events.onPlaybackFinished(track(), PLAYER, "skipped");

    const sessions = info.mock.calls.filter(
      ([, message]) => message === "Playback session",
    );
    expect(sessions[0]?.[0]).toMatchObject({
      audioUrlMs: 90,
      cacheHit: true,
      metadataMs: 40,
      reason: "completed",
    });
    expect(sessions[1]?.[0]).not.toHaveProperty("metadataMs");
    expect(playbackMetrics.record).toHaveBeenCalledTimes(2);
    expect(listeningHistory.recordFinish).toHaveBeenLastCalledWith(
      "uid-ana",
      { id: "abc", title: "Artist - Song" },
      false,
    );
  });

  it("counts prefetch results of audio URL timings", () => {
    const { events, metrics } = harness();
    for (const prefetchStatus of ["hit", "in-flight", "miss"] as const) {
      events.onTiming({
        durationMs: 1,
        prefetchStatus,
        stage: "audio-url",
        trackId: prefetchStatus,
      });
    }
    expect(metrics.increment.mock.calls.map(([name]) => name)).toEqual([
      "prefetchHits",
      "prefetchInFlight",
      "prefetchMisses",
    ]);
  });

  it("records and announces playback errors", async () => {
    const { events, metrics, sendChannelMessage } = harness();
    const error = new Error("HTTP error 403 Forbidden");
    await events.onPlaybackError(track(), error);
    expect(metrics.recordError).toHaveBeenCalledWith(
      "abc",
      error,
      "Artist - Song",
    );
    expect(sendChannelMessage).toHaveBeenCalledWith(
      'No pude reproducir "Artist - Song". Se intentará continuar con la siguiente canción.',
    );
  });
});

describe("TrackTimings", () => {
  it("keeps at most 200 tracks, dropping the oldest", () => {
    const timings = new TrackTimings();
    for (let index = 0; index < 205; index++)
      timings.merge(`t${index}`, { metadataMs: index });
    expect(timings.size).toBe(200);
    expect(timings.get("t0")).toBeUndefined();
    expect(timings.get("t204")).toEqual({ metadataMs: 204 });
  });
});
