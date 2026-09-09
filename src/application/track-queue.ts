import type { Track, TrackId } from "../domain/track.js";
import { PlaybackQueue } from "../domain/playback-queue.js";
import { UserError } from "../lib/user-error.js";

export class QueueLimitError extends UserError {}

export interface TrackQueueOptions {
  readonly maxQueueTracks?: number;
  readonly maxTracksPerUser?: number;
}

const DEFAULT_MAX_QUEUE_TRACKS = 200;
const DEFAULT_MAX_TRACKS_PER_USER = 30;

// Queue ownership extracted from YoutubePlaybackService: the raw container
// plus the limit policy that used to live inside #enqueueMetadata. Internal
// re-adds (loop refill, seek/filter restart, resolve retry) bypass the
// limits through requeue, exactly like the old direct container writes.
export class TrackQueue {
  readonly #queue = new PlaybackQueue();
  readonly #maxQueueTracks: number;
  readonly #maxTracksPerUser: number;

  constructor(options: TrackQueueOptions = {}) {
    this.#maxQueueTracks = options.maxQueueTracks ?? DEFAULT_MAX_QUEUE_TRACKS;
    this.#maxTracksPerUser =
      options.maxTracksPerUser ?? DEFAULT_MAX_TRACKS_PER_USER;
  }

  get length(): number {
    return this.#queue.length;
  }

  get maxTracks(): number {
    return this.#maxQueueTracks;
  }

  snapshot(): readonly Track[] {
    return this.#queue.snapshot();
  }

  next(): Track | undefined {
    return this.#queue.next();
  }

  add(track: Track, current: Track | undefined): void {
    if (this.#queue.length >= this.#maxQueueTracks) {
      throw new QueueLimitError(
        `La cola está llena (máximo ${this.#maxQueueTracks} pistas).`,
      );
    }
    const { requestedBy, requestedByUid } = track;
    const currentCounts =
      current !== undefined &&
      (requestedByUid !== undefined
        ? current.requestedByUid === requestedByUid
        : current.requestedBy === requestedBy);
    const requesterCount =
      (currentCounts ? 1 : 0) +
      this.#queue
        .snapshot()
        .filter((queued) =>
          requestedByUid !== undefined
            ? queued.requestedByUid === requestedByUid
            : queued.requestedBy === requestedBy,
        ).length;
    if (requesterCount >= this.#maxTracksPerUser) {
      throw new QueueLimitError(
        `Límite de ${this.#maxTracksPerUser} pistas por usuario en la cola.`,
      );
    }
    this.#queue.add(track);
  }

  requeue(track: Track): void {
    this.#queue.add(track);
  }

  moveToHead(trackId: TrackId): boolean {
    return this.#queue.moveToHead(trackId);
  }

  move(fromPosition: number, toPosition: number): Track | undefined {
    return this.#queue.move(fromPosition, toPosition);
  }

  removeAt(position: number): Track | undefined {
    const track = this.#queue.snapshot()[position - 1];
    return track ? this.#queue.remove(track.id) : undefined;
  }

  removeRange(fromPosition: number, toPosition: number): Track[] {
    return this.#queue.removeRange(fromPosition, toPosition);
  }

  clear(): void {
    this.#queue.clear();
  }

  shuffle(): void {
    this.#queue.shuffle();
  }
}
