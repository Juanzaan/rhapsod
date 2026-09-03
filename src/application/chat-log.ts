export interface ChatEntry {
  readonly ts: number;
  readonly from: string;
  readonly text: string;
  readonly outgoing: boolean;
}

const MAX_ENTRIES = 50;
const MAX_TEXT_LENGTH = 500;

/**
 * Small in-memory ring of TeamSpeak channel chat (both directions) so the
 * web panel can show what is happening in the channel. Private messages are
 * never recorded: only channel traffic reaches this log.
 */
export class ChatLog {
  readonly #entries: ChatEntry[] = [];

  constructor(private readonly maxEntries: number = MAX_ENTRIES) {}

  push(from: string, text: string, outgoing: boolean): void {
    const clean = text.replace(/\s+/g, " ").trim();
    if (clean.length === 0) return;
    this.#entries.push({
      ts: Date.now(),
      from: from.length > 0 ? from : "?",
      text:
        clean.length > MAX_TEXT_LENGTH
          ? `${clean.slice(0, MAX_TEXT_LENGTH - 1)}…`
          : clean,
      outgoing,
    });
    while (this.#entries.length > this.maxEntries) {
      this.#entries.shift();
    }
  }

  snapshot(): readonly ChatEntry[] {
    return [...this.#entries];
  }
}
