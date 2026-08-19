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

interface FfmpegPlaybackOptions extends FfmpegPcmOptions {
  readonly clock?: AudioPlayerClock;
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

export function playFfmpegUrl(
  url: string,
  encoder: RhapsodOpusEncoder,
  output: VoiceFrameOutput,
  options: FfmpegPlaybackOptions = {},
): FfmpegPlaybackSession {
  const createStream = options.createStream ?? createFfmpegPcmStream;
  const source = createStream(url, options);
  const player = new AudioPlayer(encoder, output, options.clock);
  const done = player.play(source.stream).finally(() => source.stop());

  return {
    done,
    player,
    stop: () => {
      player.stop();
      source.stop();
    },
  };
}
