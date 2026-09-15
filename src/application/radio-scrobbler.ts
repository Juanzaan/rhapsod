import { createHash } from "node:crypto";

import { parseArtistTitle } from "../media/lyrics.js";

export interface ScrobbleHistory {
  recordStart(uid: string, track: { id: string; title: string }): void;
  recordFinish(
    uid: string,
    track: { id: string; title: string },
    completed: boolean,
  ): void;
}

export interface ScrobbleResolver {
  search(
    query: string,
    expectedDurationSeconds?: number,
    expectedTitle?: string,
  ): Promise<{ id: string; title: string }>;
}

export interface ScrobbleLibrary {
  record(track: { id: string; title: string }): void;
}

export interface RadioScrobblePoll {
  readonly source: string;
  readonly uid: string;
  readonly title: string | undefined;
}

// A title only counts once heard across consecutive polls (production polls
// every 30s, so roughly a minute of airtime): a song zapped past in one
// poll never reaches the history. Anything confirmed is credited as one
// completed play under the listener who tuned the station, globally too,
// so !tops, taste profiles and autoplay seeds all learn the station's
// rotation. Resolution to a YouTube id is what makes a scrobble seedable;
// when search fails the raw title is kept under a synthetic id so at least
// the artist and token scores still learn it.
const CONFIRM_SIGHTINGS = 2;
const MAX_SOURCES = 50;

interface SourceState {
  recorded: boolean;
  sightings: number;
  title: string;
}

export class RadioScrobbler {
  readonly #history: ScrobbleHistory;
  readonly #resolver: ScrobbleResolver;
  readonly #library: ScrobbleLibrary;
  readonly #state = new Map<string, SourceState>();

  constructor(
    history: ScrobbleHistory,
    resolver: ScrobbleResolver,
    library: ScrobbleLibrary,
  ) {
    this.#history = history;
    this.#resolver = resolver;
    this.#library = library;
  }

  async poll(poll: RadioScrobblePoll): Promise<void> {
    try {
      await this.#pollImpl(poll);
    } catch {
      // Scrobbling is observability: it must never break playback or the
      // polling interval that also refreshes the displayed live title.
    }
  }

  async #pollImpl({ source, uid, title }: RadioScrobblePoll): Promise<void> {
    if (title === undefined || title.length === 0) return;
    const previous = this.#state.get(source);
    if (previous === undefined || previous.title !== title) {
      this.#state.set(source, { recorded: false, sightings: 1, title });
      if (this.#state.size > MAX_SOURCES) {
        const oldest = this.#state.keys().next().value;
        if (oldest !== undefined) this.#state.delete(oldest);
      }
      return;
    }
    previous.sightings++;
    if (previous.recorded || previous.sightings < CONFIRM_SIGHTINGS) return;
    previous.recorded = true;
    const track = await this.#resolve(title, source);
    this.#history.recordStart(uid, track);
    this.#history.recordFinish(uid, track, true);
    this.#library.record(track);
  }

  async #resolve(
    title: string,
    source: string,
  ): Promise<{ id: string; title: string }> {
    const { artist, title: parsed } = parseArtistTitle(title);
    const query =
      artist === undefined ? title : `${artist} ${parsed}`.trim() || title;
    try {
      const match = await this.#resolver.search(query, undefined, title);
      return { id: match.id, title: match.title };
    } catch {
      return {
        id: `radio:${createHash("sha1").update(`${source}${title}`).digest("hex").slice(0, 12)}`,
        title,
      };
    }
  }
}
