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

  next(): Track | undefined {
    return this.#tracks.shift();
  }

  remove(trackId: TrackId): Track | undefined {
    const index = this.#tracks.findIndex((track) => track.id === trackId);
    if (index === -1) return undefined;
    return this.#tracks.splice(index, 1)[0];
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
