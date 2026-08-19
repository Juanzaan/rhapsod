import type { Track, TrackId } from "./track.js";

export class PlaybackQueue {
  readonly #tracks: Track[] = [];

  get length(): number {
    return this.#tracks.length;
  }

  add(track: Track): void {
    if (this.#tracks.some((queuedTrack) => queuedTrack.id === track.id)) {
      throw new Error(`Track ${track.id} is already queued`);
    }
    this.#tracks.push(track);
  }

  moveToHead(trackId: TrackId): boolean {
    const index = this.#tracks.findIndex((track) => track.id === trackId);
    if (index <= 0) return index === 0;
    const [track] = this.#tracks.splice(index, 1);
    if (!track) return false;
    this.#tracks.unshift(track);
    return true;
  }

  next(): Track | undefined {
    return this.#tracks.shift();
  }

  remove(trackId: TrackId): Track | undefined {
    const index = this.#tracks.findIndex((track) => track.id === trackId);
    if (index === -1) return undefined;
    return this.#tracks.splice(index, 1)[0];
  }

  move(fromPosition: number, toPosition: number): Track | undefined {
    if (fromPosition === toPosition) return undefined;
    if (toPosition < 1 || toPosition > this.#tracks.length) return undefined;
    const fromIndex = fromPosition - 1;
    if (fromIndex < 0 || fromIndex >= this.#tracks.length) return undefined;
    const [track] = this.#tracks.splice(fromIndex, 1);
    if (!track) return undefined;
    const toIndex = toPosition - 1;
    this.#tracks.splice(toIndex, 0, track);
    return track;
  }

  removeRange(fromPosition: number, toPosition: number): Track[] {
    const fromIndex = fromPosition - 1;
    if (fromPosition < 1 || toPosition < fromPosition) {
      throw new Error(`Invalid range ${fromPosition}-${toPosition}`);
    }
    if (fromIndex >= this.#tracks.length) return [];
    return this.#tracks.splice(fromIndex, toPosition - fromPosition + 1);
  }

  snapshot(): readonly Track[] {
    return [...this.#tracks];
  }

  shuffle(): void {
    for (let i = this.#tracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const current = this.#tracks[i];
      const swap = this.#tracks[j];
      if (current === undefined || swap === undefined) continue;
      this.#tracks[i] = swap;
      this.#tracks[j] = current;
    }
  }

  clear(): void {
    this.#tracks.length = 0;
  }
}
