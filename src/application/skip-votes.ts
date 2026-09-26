export interface SkipVoteResult {
  readonly passed: boolean;
  /** Votes from people still listening. */
  readonly votes: number;
  /** Votes the skip needs: more than half of the listeners. */
  readonly needed: number;
}

/**
 * Votes to skip the current play. Votes belong to one play, so they reset
 * when the track changes, and a voter who left the channel stops counting:
 * otherwise a listener could vote and leave to lower the bar.
 */
export class SkipVotes {
  #play: object | undefined;
  readonly #voters = new Set<string>();

  vote(
    play: object,
    uid: string,
    listeners: readonly string[],
  ): SkipVoteResult {
    if (this.#play !== play) {
      this.#play = play;
      this.#voters.clear();
    }
    this.#voters.add(uid);
    const present = new Set(listeners);
    const votes = [...this.#voters].filter((voter) =>
      present.has(voter),
    ).length;
    const needed = Math.floor(present.size / 2) + 1;
    const passed = votes >= needed;
    if (passed) {
      this.#play = undefined;
      this.#voters.clear();
    }
    return { needed, passed, votes };
  }
}
