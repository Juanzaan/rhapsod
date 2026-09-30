import { describe, expect, it } from "vitest";
import { getPacketInfo } from "libopus-wasm";

import {
  CHANNELS,
  FRAME_DURATION_MS,
  PCM_FRAME_BYTES,
  SAMPLE_RATE,
  SAMPLES_PER_CHANNEL,
  TS3_MAX_OPUS_BYTES,
  createRhapsodOpusEncoder,
} from "../src/audio/opus-encoder.js";

describe("Rhapsod Opus encoder", () => {
  it("encodes a 20ms stereo PCM frame within the TS3 packet budget", async () => {
    const encoder = await createRhapsodOpusEncoder({ bitrate: 128_000 });
    try {
      const packet = encoder.encode(new Uint8Array(PCM_FRAME_BYTES));
      const info = await getPacketInfo(packet, { sampleRate: SAMPLE_RATE });
      expect(encoder.pcmFrameBytes).toBe(PCM_FRAME_BYTES);
      expect(packet.byteLength).toBeGreaterThan(0);
      expect(packet.byteLength).toBeLessThanOrEqual(TS3_MAX_OPUS_BYTES);
      expect(info.durationMs).toBe(FRAME_DURATION_MS);
    } finally {
      encoder.close();
    }
  });

  it("keeps dense audio inside the 500-byte TeamSpeak packet", async () => {
    const encoder = await createRhapsodOpusEncoder({ bitrate: 160_000 });
    let seed = 1;
    const noise = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed / 2 ** 30 - 1;
    };
    let largest = 0;
    try {
      for (let frame = 0; frame < 50; frame++) {
        const pcm = new Uint8Array(PCM_FRAME_BYTES);
        const view = new DataView(pcm.buffer);
        for (let i = 0; i < PCM_FRAME_BYTES / 2; i++) {
          view.setInt16(i * 2, Math.round(noise() * 20_000), true);
        }
        largest = Math.max(largest, encoder.encode(pcm).byteLength);
      }
    } finally {
      encoder.close();
    }
    // 8-byte MAC, 5-byte header and 3-byte voice header around the Opus.
    expect(largest + 8 + 5 + 3).toBeLessThanOrEqual(500);
  });

  it("uses the documented PCM geometry", () => {
    expect(SAMPLE_RATE).toBe(48_000);
    expect(CHANNELS).toBe(2);
    expect(FRAME_DURATION_MS).toBe(20);
    expect(SAMPLES_PER_CHANNEL).toBe(960);
    expect(PCM_FRAME_BYTES).toBe(3_840);
  });

  it("encodes with the default complexity and FEC under the packet budget", async () => {
    const encoder = await createRhapsodOpusEncoder({
      packetLossPercent: 10,
    });
    try {
      const packet = encoder.encode(new Uint8Array(PCM_FRAME_BYTES));
      expect(packet.byteLength).toBeLessThanOrEqual(TS3_MAX_OPUS_BYTES);
    } finally {
      encoder.close();
    }
  });

  it("rejects partial PCM frames", async () => {
    const encoder = await createRhapsodOpusEncoder();
    try {
      expect(() => encoder.encode(new Uint8Array(PCM_FRAME_BYTES - 1))).toThrow(
        "Expected 3840 PCM bytes",
      );
    } finally {
      encoder.close();
    }
  });
});
