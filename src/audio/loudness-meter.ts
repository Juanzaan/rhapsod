// ITU-R BS.1770-4 at 48 kHz: K-weighting as two biquads (a high shelf, then
// the RLB high-pass), 400 ms blocks every 100 ms, an absolute gate at
// -70 LUFS and a relative gate 10 LU under the absolute-gated loudness.
const SHELF = {
  a1: -1.69065929318241,
  a2: 0.73248077421585,
  b0: 1.53512485958697,
  b1: -2.69169618940638,
  b2: 1.19839281085285,
};
const HIGH_PASS = {
  a1: -1.99004745483398,
  a2: 0.99007225036621,
  b0: 1,
  b1: -2,
  b2: 1,
};
const CHANNELS = 2;
const SAMPLES_PER_STEP = 4_800; // 100 ms
const STEPS_PER_BLOCK = 4; // 400 ms
const ABSOLUTE_GATE_LUFS = -70;
const RELATIVE_GATE_LU = 10;

// BS.1770-4 Annex 2: 4x oversampling FIR, 12 taps per phase.
const TRUE_PEAK_PHASES: readonly (readonly number[])[] = [
  [
    0.001708984375, 0.010986328125, -0.0196533203125, 0.033203125,
    -0.0594482421875, 0.1373291015625, 0.97216796875, -0.102294921875,
    0.047607421875, -0.026611328125, 0.014892578125, -0.00830078125,
  ],
  [
    -0.0291748046875, 0.029296875, -0.0517578125, 0.089111328125,
    -0.16650390625, 0.465087890625, 0.77978515625, -0.2003173828125, 0.1015625,
    -0.0582275390625, 0.0330810546875, -0.0189208984375,
  ],
  [
    -0.0189208984375, 0.0330810546875, -0.0582275390625, 0.1015625,
    -0.2003173828125, 0.77978515625, 0.465087890625, -0.16650390625,
    0.089111328125, -0.0517578125, 0.029296875, -0.0291748046875,
  ],
  [
    -0.00830078125, 0.014892578125, -0.026611328125, 0.047607421875,
    -0.102294921875, 0.97216796875, 0.1373291015625, -0.0594482421875,
    0.033203125, -0.0196533203125, 0.010986328125, 0.001708984375,
  ],
];
const TAPS = 12;
const PHASE_COUNT = TRUE_PEAK_PHASES.length;
const TRUE_PEAK_TAPS = Float64Array.from(TRUE_PEAK_PHASES.flat());

export interface DeliveredLoudness {
  /** Gated integrated loudness; undefined until a block passes the gates. */
  readonly integratedLufs?: number;
  readonly truePeakDbtp?: number;
}

class Biquad {
  readonly #c: typeof SHELF;
  #x1 = 0;
  #x2 = 0;
  #y1 = 0;
  #y2 = 0;

  constructor(coefficients: typeof SHELF) {
    this.#c = coefficients;
  }

  process(x: number): number {
    const { a1, a2, b0, b1, b2 } = this.#c;
    const y =
      b0 * x + b1 * this.#x1 + b2 * this.#x2 - a1 * this.#y1 - a2 * this.#y2;
    this.#x2 = this.#x1;
    this.#x1 = x;
    this.#y2 = this.#y1;
    this.#y1 = y;
    return y;
  }
}

/**
 * Streaming BS.1770 meter for 48 kHz stereo s16le PCM. Fed the frames a
 * play actually sends, it reports what listeners heard, independent of
 * what the loudness profiler predicted.
 */
export class LoudnessMeter {
  readonly #filters = Array.from({ length: CHANNELS }, () => [
    new Biquad(SHELF),
    new Biquad(HIGH_PASS),
  ]);
  readonly #history = Array.from(
    { length: CHANNELS },
    () => new Float64Array(TAPS * 2),
  );
  #historyAt = 0;
  #stepEnergy = 0;
  #stepSamples = 0;
  readonly #steps: number[] = [];
  readonly #blockPowers: number[] = [];
  #peak = 0;
  #cached: DeliveredLoudness | undefined;

  /** Adds one or more interleaved stereo s16le frames. */
  add(pcm: Uint8Array): void {
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    const frames = Math.floor(pcm.byteLength / (2 * CHANNELS));
    for (let i = 0; i < frames; i++) {
      let energy = 0;
      for (let channel = 0; channel < CHANNELS; channel++) {
        const sample =
          view.getInt16((i * CHANNELS + channel) * 2, true) / 32_768;
        const [shelf, highPass] = this.#filters[channel]!;
        const weighted = highPass!.process(shelf!.process(sample));
        energy += weighted * weighted;
        this.#trackPeak(channel, sample);
      }
      this.#historyAt = (this.#historyAt + 1) % TAPS;
      this.#stepEnergy += energy;
      if (++this.#stepSamples === SAMPLES_PER_STEP) this.#closeStep();
    }
    this.#cached = undefined;
  }

  get result(): DeliveredLoudness {
    this.#cached ??= this.#compute();
    return this.#cached;
  }

  #trackPeak(channel: number, sample: number): void {
    // Each sample is written twice, TAPS apart, so the newest TAPS samples
    // are always contiguous and the inner loop needs no wraparound.
    const history = this.#history[channel]!;
    const newest = this.#historyAt + TAPS;
    history[this.#historyAt] = sample;
    history[newest] = sample;
    for (let phase = 0; phase < PHASE_COUNT; phase++) {
      const offset = phase * TAPS;
      let value = 0;
      for (let tap = 0; tap < TAPS; tap++) {
        value += TRUE_PEAK_TAPS[offset + tap]! * history[newest - tap]!;
      }
      const magnitude = Math.abs(value);
      if (magnitude > this.#peak) this.#peak = magnitude;
    }
  }

  #closeStep(): void {
    this.#steps.push(this.#stepEnergy / SAMPLES_PER_STEP);
    this.#stepEnergy = 0;
    this.#stepSamples = 0;
    if (this.#steps.length > STEPS_PER_BLOCK) this.#steps.shift();
    if (this.#steps.length === STEPS_PER_BLOCK) {
      this.#blockPowers.push(
        this.#steps.reduce((sum, power) => sum + power, 0) / STEPS_PER_BLOCK,
      );
    }
  }

  #compute(): DeliveredLoudness {
    const truePeak =
      this.#peak > 0
        ? { truePeakDbtp: round(20 * Math.log10(this.#peak)) }
        : {};
    const absolute = this.#blockPowers.filter(
      (power) => loudness(power) > ABSOLUTE_GATE_LUFS,
    );
    if (absolute.length === 0) return truePeak;
    const threshold = loudness(mean(absolute)) - RELATIVE_GATE_LU;
    const gated = absolute.filter((power) => loudness(power) > threshold);
    return { integratedLufs: round(loudness(mean(gated))), ...truePeak };
  }
}

function loudness(power: number): number {
  return -0.691 + 10 * Math.log10(power);
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
