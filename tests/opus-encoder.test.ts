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

  it("uses the documented PCM geometry", () => {
    expect(SAMPLE_RATE).toBe(48_000);
    expect(CHANNELS).toBe(2);
    expect(FRAME_DURATION_MS).toBe(20);
    expect(SAMPLES_PER_CHANNEL).toBe(960);
    expect(PCM_FRAME_BYTES).toBe(3_840);
  });

  it("encodes with high complexity and FEC under the packet budget", async () => {
    const encoder = await createRhapsodOpusEncoder({
      complexity: 10,
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
