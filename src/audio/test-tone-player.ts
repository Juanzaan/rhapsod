import { FrameScheduler } from "./frame-scheduler.js";
import { FRAME_DURATION_MS, type RhapsodOpusEncoder } from "./opus-encoder.js";
import { TestToneGenerator } from "./test-tone.js";

export interface TestToneOutput {
  sendVoiceFrame(frame: Uint8Array): void;
}

export function playTestTone(
  durationSeconds: number,
  encoder: RhapsodOpusEncoder,
  output: TestToneOutput,
): Promise<void> {
  if (durationSeconds <= 0 || !Number.isFinite(durationSeconds)) {
    return Promise.resolve();
  }

  const frameCount = Math.ceil((durationSeconds * 1000) / FRAME_DURATION_MS);
  const tone = new TestToneGenerator();
  const scheduler = new FrameScheduler();

  return new Promise<void>((resolve, reject) => {
    let sent = 0;
    scheduler.start(() => {
      try {
        output.sendVoiceFrame(encoder.encode(tone.nextFrame()));
        sent++;
        if (sent >= frameCount) {
          scheduler.stop();
          resolve();
        }
      } catch (error) {
        scheduler.stop();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}
