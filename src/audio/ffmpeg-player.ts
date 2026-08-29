import {
  AudioPlayer,
  type AudioPlayerClock,
  type VoiceFrameOutput,
} from "./audio-player.js";
import {
  createFfmpegPcmStream,
  type FfmpegPcmOptions,
  type FfmpegPcmStream,
} from "./ffmpeg-pcm.js";
import { type RhapsodOpusEncoder } from "./opus-encoder.js";

export interface FfmpegPlaybackOptions extends FfmpegPcmOptions {
  readonly clock?: AudioPlayerClock;
  readonly stream?: FfmpegPcmStream;
  readonly createStream?: (
    url: string,
    options: FfmpegPcmOptions,
  ) => FfmpegPcmStream;
}

export interface FfmpegPlaybackSession {
  readonly player: AudioPlayer;
  readonly done: Promise<void>;
  stop(): void;
}

/**
 * Creates a new PCM stream (ffmpeg subprocess) for a track without starting
 * playback. The service uses this to pre-spawn the NEXT track's stream while
 * the current one is still playing, so the handoff is gapless.
 */
export function createPcmStream(
  url: string,
  options: FfmpegPlaybackOptions = {},
): FfmpegPcmStream {
  const createStream = options.createStream ?? createFfmpegPcmStream;
  return createStream(url, options);
}

/**
 * Plays a stream through a fresh AudioPlayer, returning a session whose
 * `done` resolves when playback completes.
 */
export function playPcmStream(
  stream: FfmpegPcmStream,
  encoder: RhapsodOpusEncoder,
  output: VoiceFrameOutput,
  options: FfmpegPlaybackOptions = {},
): FfmpegPlaybackSession {
  const player = new AudioPlayer(encoder, output, options.clock);
  const done = player.play(stream.stream).finally(() => stream.stop());

  return {
    done,
    player,
    stop: () => {
      player.stop();
      stream.stop();
    },
  };
}

export function playFfmpegUrl(
  url: string,
  encoder: RhapsodOpusEncoder,
  output: VoiceFrameOutput,
  options: FfmpegPlaybackOptions = {},
): FfmpegPlaybackSession {
  const source = options.stream ?? createPcmStream(url, options);
  return playPcmStream(source, encoder, output, options);
}
