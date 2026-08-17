import {
  CHANNELS,
  PCM_FRAME_BYTES,
  SAMPLE_RATE,
  SAMPLES_PER_CHANNEL,
} from "./opus-encoder.js";

export class TestToneGenerator {
  #sampleOffset = 0;

  constructor(
    readonly frequencyHz = 440,
    readonly amplitude = 0.15,
  ) {
    if (frequencyHz <= 0 || !Number.isFinite(frequencyHz)) {
      throw new RangeError("Test tone frequency must be positive");
    }
    if (amplitude < 0 || amplitude > 1 || !Number.isFinite(amplitude)) {
      throw new RangeError("Test tone amplitude must be between 0 and 1");
    }
  }

  nextFrame(): Uint8Array {
    const frame = new Int16Array(SAMPLES_PER_CHANNEL * CHANNELS);
    for (let sample = 0; sample < SAMPLES_PER_CHANNEL; sample++) {
      const value = Math.round(
        Math.sin(
          (2 * Math.PI * this.frequencyHz * (this.#sampleOffset + sample)) /
            SAMPLE_RATE,
        ) *
          this.amplitude *
          32_767,
      );
      const offset = sample * CHANNELS;
      frame[offset] = value;
      frame[offset + 1] = value;
    }
    this.#sampleOffset += SAMPLES_PER_CHANNEL;
    return new Uint8Array(frame.buffer, frame.byteOffset, PCM_FRAME_BYTES);
  }
}
