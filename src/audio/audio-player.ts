import type { Readable } from "node:stream";

import { FrameScheduler } from "./frame-scheduler.js";
import {
  FRAME_DURATION_MS,
  PCM_FRAME_BYTES,
  type RhapsodOpusEncoder,
} from "./opus-encoder.js";

const PREBUFFER_FRAMES = 12;
const BUFFER_HIGH_WATER_FRAMES = 250;
const BUFFER_LOW_WATER_FRAMES = 150;
const MAX_UNDERRUN_FRAMES = 250;

export function applyGain(pcm: Uint8Array, gain: number): Uint8Array {
  if (gain === 1) return pcm;
  const output = new Uint8Array(pcm.byteLength);
  for (let i = 0; i < pcm.byteLength; i += 2) {
    const low = pcm[i] ?? 0;
    const high = pcm[i + 1] ?? 0;
    let sample = low | (high << 8);
    if (sample & 0x8000) sample -= 0x10000;
    sample = Math.max(-32768, Math.min(32767, Math.round(sample * gain)));
    output[i] = sample & 0xff;
    output[i + 1] = (sample >> 8) & 0xff;
  }
  return output;
}

type AudioPlayerState = "idle" | "buffering" | "playing" | "paused";

export interface VoiceFrameOutput {
  sendVoiceFrame(frame: Uint8Array): void;
}

export interface AudioPlayerClock {
  start(onFrame: () => void): void;
  stop(): void;
}

export interface AudioPlayerMetrics {
  readonly bufferedBytes: number;
  readonly firstFrameDelayMs?: number;
  readonly framesSent: number;
  readonly maxBufferedBytes: number;
  readonly rebufferEvents: number;
  readonly underruns: number;
}

export class AudioPlayer {
  readonly #encoder: RhapsodOpusEncoder;
  readonly #output: VoiceFrameOutput;
  readonly #clock: AudioPlayerClock;
  readonly #silence = new Uint8Array(PCM_FRAME_BYTES);
  #chunks: Uint8Array[] = [];
  #chunkOffset = 0;
  #bufferedBytes = 0;
  #framesSent = 0;
  #firstFrameDelayMs: number | undefined;
  #playStartedAt = 0;
  #maxBufferedBytes = 0;
  #rebufferEvents = 0;
  #underruns = 0;
  #source: Readable | undefined;
  #sourceEnded = false;
  #sourcePaused = false;
  #recovering = false;
  #recoveryTimer: NodeJS.Timeout | undefined;
  #state: AudioPlayerState = "idle";
  #gain = 1;
  #completion: Promise<void> | undefined;
  #resolveCompletion: (() => void) | undefined;
  #rejectCompletion: ((error: Error) => void) | undefined;

  constructor(
    encoder: RhapsodOpusEncoder,
    output: VoiceFrameOutput,
    clock: AudioPlayerClock = new FrameScheduler(),
  ) {
    this.#encoder = encoder;
    this.#output = output;
    this.#clock = clock;
  }

  get state(): AudioPlayerState {
    return this.#state;
  }

  setVolume(gain: number): void {
    this.#gain = Math.max(0, Math.min(1, gain));
  }

  get metrics(): AudioPlayerMetrics {
    return {
      bufferedBytes: this.#bufferedBytes,
      ...(this.#firstFrameDelayMs === undefined
        ? {}
        : { firstFrameDelayMs: this.#firstFrameDelayMs }),
      framesSent: this.#framesSent,
      maxBufferedBytes: this.#maxBufferedBytes,
      rebufferEvents: this.#rebufferEvents,
      underruns: this.#underruns,
    };
  }

  play(source: Readable): Promise<void> {
    this.stop();
    this.#resetSession();
    this.#source = source;
    this.#playStartedAt = Date.now();
    this.#state = "buffering";
    this.#completion = new Promise<void>((resolve, reject) => {
      this.#resolveCompletion = resolve;
      this.#rejectCompletion = reject;
    });

    source.on("data", this.#handleData);
    source.once("end", this.#handleEnd);
    source.once("error", this.#handleError);
    return this.#completion;
  }

  pause(): void {
    if (this.#state !== "playing" && this.#state !== "buffering") return;
    this.#state = "paused";
    this.#clock.stop();
    this.#pauseSource();
  }

  resume(): void {
    if (this.#state !== "paused") return;
    this.#state =
      this.#bufferedBytes >= this.#requiredBufferBytes()
        ? "playing"
        : "buffering";
    this.#resumeSource();
    if (this.#state === "playing") this.#clock.start(this.#sendNextFrame);
  }

  stop(): void {
    if (this.#state === "idle") return;
    this.#clearRecoveryTimer();
    this.#clock.stop();
    this.#detachSource(true);
    this.#state = "idle";
    this.#resolveCompletion?.();
    this.#clearCompletion();
    this.#resetBuffer();
  }

  readonly #handleData = (chunk: Buffer): void => {
    if (this.#state === "idle") return;
    if (chunk.byteLength > 0) {
      this.#chunks.push(chunk);
      this.#bufferedBytes += chunk.byteLength;
      this.#maxBufferedBytes = Math.max(
        this.#maxBufferedBytes,
        this.#bufferedBytes,
      );
    }

    if (
      this.#state === "buffering" &&
      (this.#bufferedBytes >= this.#requiredBufferBytes() ||
        (this.#sourceEnded && this.#bufferedBytes >= PCM_FRAME_BYTES))
    ) {
      this.#state = "playing";
      this.#recovering = false;
      this.#clearRecoveryTimer();
      this.#clock.start(this.#sendNextFrame);
    }
    if (this.#bufferedBytes >= BUFFER_HIGH_WATER_FRAMES * PCM_FRAME_BYTES) {
      this.#pauseSource();
    }
  };

  readonly #handleEnd = (): void => {
    this.#sourceEnded = true;
    this.#clearRecoveryTimer();
    if (this.#state === "buffering") {
      if (this.#bufferedBytes >= PCM_FRAME_BYTES) {
        this.#state = "playing";
        this.#clock.start(this.#sendNextFrame);
      } else {
        this.#finish();
      }
    }
  };

  readonly #handleError = (error: Error): void => {
    this.#fail(error);
  };

  readonly #sendNextFrame = (): void => {
    if (this.#state !== "playing") return;
    if (this.#bufferedBytes >= PCM_FRAME_BYTES) {
      const pcm = applyGain(this.#readFrame(), this.#gain);
      this.#output.sendVoiceFrame(this.#encoder.encode(pcm));
      this.#firstFrameDelayMs ??= Date.now() - this.#playStartedAt;
      this.#framesSent++;
      if (this.#recovering) {
        this.#recovering = false;
        this.#clearRecoveryTimer();
      }
      if (
        this.#sourcePaused &&
        this.#bufferedBytes <= BUFFER_LOW_WATER_FRAMES * PCM_FRAME_BYTES
      ) {
        this.#resumeSource();
      }
      return;
    }

    if (this.#sourceEnded) {
      this.#finish();
      return;
    }

    this.#underruns++;
    this.#output.sendVoiceFrame(this.#encoder.encode(this.#silence));
    this.#framesSent++;
    if (!this.#recovering) {
      this.#recovering = true;
      this.#rebufferEvents++;
      this.#recoveryTimer = setTimeout(() => {
        if (!this.#recovering) return;
        this.#fail(
          new Error(
            `Audio source stalled for ${MAX_UNDERRUN_FRAMES * FRAME_DURATION_MS}ms`,
          ),
        );
      }, MAX_UNDERRUN_FRAMES * FRAME_DURATION_MS);
    }
  };

  #readFrame(): Uint8Array {
    const frame = new Uint8Array(PCM_FRAME_BYTES);
    let written = 0;
    while (written < PCM_FRAME_BYTES) {
      const chunk = this.#chunks[0];
      if (chunk === undefined)
        throw new Error("PCM buffer accounting mismatch");
      const available = chunk.byteLength - this.#chunkOffset;
      const length = Math.min(PCM_FRAME_BYTES - written, available);
      frame.set(
        chunk.subarray(this.#chunkOffset, this.#chunkOffset + length),
        written,
      );
      written += length;
      this.#chunkOffset += length;
      this.#bufferedBytes -= length;
      if (this.#chunkOffset === chunk.byteLength) {
        this.#chunks.shift();
        this.#chunkOffset = 0;
      }
    }
    return frame;
  }

  #pauseSource(): void {
    if (!this.#source || this.#sourcePaused) return;
    this.#source.pause();
    this.#sourcePaused = true;
  }

  #resumeSource(): void {
    if (!this.#source || !this.#sourcePaused) return;
    this.#source.resume();
    this.#sourcePaused = false;
  }

  #finish(): void {
    this.#clearRecoveryTimer();
    this.#clock.stop();
    this.#detachSource();
    this.#state = "idle";
    this.#resolveCompletion?.();
    this.#clearCompletion();
    this.#resetBuffer();
  }

  #fail(error: Error): void {
    this.#clearRecoveryTimer();
    this.#clock.stop();
    this.#detachSource(true);
    this.#state = "idle";
    this.#rejectCompletion?.(error);
    this.#clearCompletion();
    this.#resetBuffer();
  }

  #detachSource(destroy = false): void {
    if (!this.#source) return;
    const source = this.#source;
    source.off("data", this.#handleData);
    source.off("end", this.#handleEnd);
    source.off("error", this.#handleError);
    this.#source = undefined;
    if (destroy) source.destroy();
  }

  #resetSession(): void {
    this.#resetBuffer();
    this.#framesSent = 0;
    this.#firstFrameDelayMs = undefined;
    this.#maxBufferedBytes = 0;
    this.#rebufferEvents = 0;
    this.#underruns = 0;
    this.#sourceEnded = false;
    this.#sourcePaused = false;
    this.#recovering = false;
  }

  #resetBuffer(): void {
    this.#chunks = [];
    this.#chunkOffset = 0;
    this.#bufferedBytes = 0;
  }

  #clearCompletion(): void {
    this.#completion = undefined;
    this.#resolveCompletion = undefined;
    this.#rejectCompletion = undefined;
  }

  #clearRecoveryTimer(): void {
    if (this.#recoveryTimer !== undefined) clearTimeout(this.#recoveryTimer);
    this.#recoveryTimer = undefined;
  }

  #requiredBufferBytes(): number {
    return PREBUFFER_FRAMES * PCM_FRAME_BYTES;
  }
}
