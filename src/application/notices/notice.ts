export type NoticeSeverity = "info" | "warning" | "error" | "critical";

export const SEVERITY_RANK: Readonly<Record<NoticeSeverity, number>> = {
  info: 0,
  warning: 1,
  error: 2,
  critical: 3,
};

/** Closed list: a new detector is a code change, reviewed with its policy. */
export type NoticeDetector =
  | "youtube.extraction-failed"
  | "youtube.cookies-invalid"
  | "youtube.soft-block"
  | "youtube.cookies-expiring"
  | "ytdlp.daemon-fallback"
  | "pot.provider-down"
  | "ts3.no-talk-power"
  | "ts3.reconnecting"
  | "process.event-loop-stall"
  | "process.restart-loop"
  | "panel.bind-exposed"
  | "disk.data-low";

/** Hidden metadata for later surfaces and logs. Never secrets or URLs. */
export type NoticeData = Readonly<Record<string, string | number | boolean>>;

/** One observation from a detector: "this is wrong right now". */
export interface Finding {
  readonly detector: NoticeDetector;
  /** Separates several notices of one detector, e.g. the reconnect give-up. */
  readonly subject?: string;
  readonly severity: NoticeSeverity;
  readonly titleEs: string;
  readonly detailEs: string;
  readonly data?: NoticeData;
  /** Survives a restart; overrides the detector's policy. */
  readonly persistent?: boolean;
}

export type NoticeState = "pending" | "open" | "ignored";

export interface Notice {
  readonly key: string;
  readonly detector: NoticeDetector;
  readonly severity: NoticeSeverity;
  readonly titleEs: string;
  readonly detailEs: string;
  readonly data?: NoticeData;
  readonly state: NoticeState;
  readonly persistent: boolean;
  readonly flapping: boolean;
  readonly firstSeen: number;
  readonly lastSeen: number;
  readonly occurrences: number;
}

export type HealthVerdict = "ok" | "degraded" | "unhealthy";

export function noticeKey(detector: NoticeDetector, subject?: string): string {
  return subject === undefined ? detector : `${detector}:${subject}`;
}
