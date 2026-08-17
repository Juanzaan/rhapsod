import type { Readable } from "node:stream";

import { FrameScheduler } from "./frame-scheduler.js";
import {
  FRAME_DURATION_MS,
  PCM_FRAME_BYTES,
  type RhapsodOpusEncoder,
} from "./opus-encoder.js";

const PREBUFFER_FRAMES = 10;
const BUFFER_HIGH_WATER_FRAMES = 100;
const BUFFER_LOW_WATER_FRAMES = 25;
const MAX_UNDERRUN_FRAMES = 250;

export type AudioPlayerState = "idle" | "buffering" | "playing" | "paused";

export interface VoiceFrameOutput {
  sendVoiceFrame(frame: Uint8Array): void;
}

export interface AudioPlayerClock {
  start(onFrame: () => void): void;
  stop(): void;
}

export interface AudioPlayerMetrics {
  readonly bufferedBytes: number;
  readonly framesSent: number;
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
  #underruns = 0;
  #consecutiveUnderruns = 0;
  #source: Readable | undefined;
  #sourceEnded = false;
  #sourcePaused = false;
  #state: AudioPlayerState = "idle";
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

  get metrics(): AudioPlayerMetrics {
    return {
      bufferedBytes: this.#bufferedBytes,
      framesSent: this.#framesSent,
      underruns: this.#underruns,
    };
  }

  play(source: Readable): Promise<void> {
    this.stop();
    this.#resetSession();
    this.#source = source;
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
      this.#bufferedBytes >= PCM_FRAME_BYTES ? "playing" : "buffering";
    this.#resumeSource();
    if (this.#state === "playing") this.#clock.start(this.#sendNextFrame);
  }

  stop(): void {
    if (this.#state === "idle") return;
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
    }

    if (
      this.#state === "buffering" &&
      (this.#bufferedBytes >= PREBUFFER_FRAMES * PCM_FRAME_BYTES ||
        (this.#sourceEnded && this.#bufferedBytes >= PCM_FRAME_BYTES))
    ) {
      this.#state = "playing";
      this.#clock.start(this.#sendNextFrame);
    }
    if (this.#bufferedBytes >= BUFFER_HIGH_WATER_FRAMES * PCM_FRAME_BYTES) {
      this.#pauseSource();
    }
  };

  readonly #handleEnd = (): void => {
    this.#sourceEnded = true;
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
      const pcm = this.#readFrame();
      this.#output.sendVoiceFrame(this.#encoder.encode(pcm));
      this.#framesSent++;
      this.#consecutiveUnderruns = 0;
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
    this.#consecutiveUnderruns++;
    this.#output.sendVoiceFrame(this.#encoder.encode(this.#silence));
    this.#framesSent++;
    if (this.#consecutiveUnderruns >= MAX_UNDERRUN_FRAMES) {
      this.#fail(
        new Error(
          `Audio source stalled for ${MAX_UNDERRUN_FRAMES * FRAME_DURATION_MS}ms`,
        ),
      );
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
    this.#clock.stop();
    this.#detachSource();
    this.#state = "idle";
    this.#resolveCompletion?.();
    this.#clearCompletion();
    this.#resetBuffer();
  }

  #fail(error: Error): void {
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
    this.#underruns = 0;
    this.#consecutiveUnderruns = 0;
    this.#sourceEnded = false;
    this.#sourcePaused = false;
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
}
