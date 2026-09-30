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
  /** Encodes one s16le frame, scaled by `gain` (the !volume) when given. */
  encode(pcm: Uint8Array, gain?: number): Uint8Array;
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

  const scaled = new Float32Array(SAMPLES_PER_CHANNEL * CHANNELS);
  const options = {
    frameSize: SAMPLES_PER_CHANNEL,
    maxPacketBytes: TS3_MAX_OPUS_BYTES,
  };

  return {
    pcmFrameBytes: PCM_FRAME_BYTES,
    encode(pcm: Uint8Array, gain = 1): Uint8Array {
      if (pcm.byteLength !== PCM_FRAME_BYTES) {
        throw new RangeError(
          `Expected ${PCM_FRAME_BYTES} PCM bytes, received ${pcm.byteLength}`,
        );
      }

      // The volume is applied in float, not back into int16: at 10% the
      // curve is -36 dB, and rounding to 16 bits after that left quiet
      // passages a few bits deep. Listeners raised their client volume to
      // compensate and heard the rounding as robotic grit (2026-09-30).
      let packet: Uint8Array;
      if (gain === 1) {
        packet = encoder.encode(pcm, options);
      } else {
        const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
        const scale = gain / 32_768;
        for (let i = 0; i < scaled.length; i++) {
          scaled[i] = view.getInt16(i * 2, true) * scale;
        }
        packet = encoder.encodeFloat(scaled, options);
      }
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
