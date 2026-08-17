import { describe, expect, it } from "vitest";

import { PCM_FRAME_BYTES } from "../src/audio/opus-encoder.js";
import { TestToneGenerator } from "../src/audio/test-tone.js";

describe("TestToneGenerator", () => {
  it("produces exact stereo PCM frames with audible headroom", () => {
    const frame = new TestToneGenerator().nextFrame();
    const samples = new Int16Array(
      frame.buffer,
      frame.byteOffset,
      frame.byteLength / 2,
    );

    expect(frame.byteLength).toBe(PCM_FRAME_BYTES);
    expect(Math.max(...samples)).toBeLessThan(6_000);
    expect(Math.max(...samples)).toBeGreaterThan(4_000);
    for (let index = 0; index < samples.length; index += 2) {
      expect(samples[index]).toBe(samples[index + 1]);
    }
  });

  it("keeps phase continuity between frames", () => {
    const tone = new TestToneGenerator();
    const first = tone.nextFrame();
    const second = tone.nextFrame();

    expect(second).not.toEqual(first);
  });
});
