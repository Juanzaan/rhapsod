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

export interface OutgoingMarker {
  readonly text: string;
  readonly ts: number;
}

const ECHO_WINDOW_MS = 5_000;

/**
 * TeamSpeak echoes our own channel messages back to us. Without this check
 * every bot message would appear twice in the log (once as sent, once as
 * received). Only exact sender+text matches inside a short window are
 * treated as echoes; anything else is always kept.
 */
export function isOwnEcho(
  senderName: string,
  nickname: string,
  message: string,
  lastOutgoing: OutgoingMarker | undefined,
  now: number,
): boolean {
  return (
    lastOutgoing !== undefined &&
    senderName === nickname &&
    message === lastOutgoing.text &&
    now - lastOutgoing.ts >= 0 &&
    now - lastOutgoing.ts <= ECHO_WINDOW_MS
  );
}
