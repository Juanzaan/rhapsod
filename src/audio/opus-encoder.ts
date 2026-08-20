import {
  Application,
  Signal,
  createEncoder,
  type OpusEncoderHandle,
} from "libopus-wasm";

export const SAMPLE_RATE = 48_000;
export const CHANNELS = 2;
export const FRAME_DURATION_MS = 20;
export const SAMPLES_PER_CHANNEL = (SAMPLE_RATE * FRAME_DURATION_MS) / 1000;
export const PCM_FRAME_BYTES = SAMPLES_PER_CHANNEL * CHANNELS * 2;
const TS3_MAX_PACKET_BYTES = 500;
const TS3_VOICE_HEADER_BYTES = 3;
export const TS3_MAX_OPUS_BYTES = TS3_MAX_PACKET_BYTES - TS3_VOICE_HEADER_BYTES;

interface OpusEncoderConfig {
  readonly bitrate?: number;
  readonly complexity?: number;
  readonly packetLossPercent?: number;
}

export interface RhapsodOpusEncoder {
  readonly pcmFrameBytes: number;
  encode(pcm: Uint8Array): Uint8Array;
  close(): void;
}

export async function createRhapsodOpusEncoder(
  config: OpusEncoderConfig = {},
): Promise<RhapsodOpusEncoder> {
  const encoder: OpusEncoderHandle = await createEncoder({
    application: Application.Audio,
    bitrate: config.bitrate ?? 128_000,
    channels: CHANNELS,
    complexity: config.complexity ?? 8,
    frameSize: SAMPLES_PER_CHANNEL,
    sampleRate: SAMPLE_RATE,
    signal: Signal.Music,
    vbr: true,
  });
  if ((config.packetLossPercent ?? 0) > 0) {
    encoder.setFec(true);
    encoder.setPacketLossPercent(config.packetLossPercent ?? 0);
  }

  return {
    pcmFrameBytes: PCM_FRAME_BYTES,
    encode(pcm: Uint8Array): Uint8Array {
      if (pcm.byteLength !== PCM_FRAME_BYTES) {
        throw new RangeError(
          `Expected ${PCM_FRAME_BYTES} PCM bytes, received ${pcm.byteLength}`,
        );
      }

      const packet = encoder.encode(pcm, {
        frameSize: SAMPLES_PER_CHANNEL,
        maxPacketBytes: TS3_MAX_OPUS_BYTES,
      });
      if (packet.byteLength > TS3_MAX_OPUS_BYTES) {
        throw new RangeError(
          `Opus packet exceeds TS3 voice limit: ${packet.byteLength} bytes`,
        );
      }

      return packet;
    },
    close(): void {
      encoder.free();
    },
  };
}
