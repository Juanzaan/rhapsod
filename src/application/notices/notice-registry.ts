import {
  DebouncedWriter,
  readJsonFile,
  writeJsonFile,
} from "../../lib/json-file-store.js";
import { noopLogger, type MinimalLogger } from "../../observability/logger.js";
import {
  noticeKey,
  SEVERITY_RANK,
  type Finding,
  type HealthVerdict,
  type Notice,
  type NoticeData,
  type NoticeDetector,
  type NoticeSeverity,
} from "./notice.js";

export interface DetectorPolicy {
  /** Findings needed inside `windowMs` before a notice leaves "pending". */
  readonly openAfter: number;
  readonly windowMs: number;
  /** Consecutive OK checks needed to resolve an open notice. */
  readonly clearAfter: number;
  readonly persistent: boolean;
  /** Resolves on its own once nothing reported it for this long. */
  readonly expireAfterMs?: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Thresholds per detector. Event-driven signals that are already debounced
 * at the source (the daily canary, talk power, the reconnect loop) open on
 * the first finding; polled probes need several misses so one slow answer
 * does not raise a notice.
 */
export const DETECTOR_POLICIES: Readonly<
  Record<NoticeDetector, DetectorPolicy>
> = {
  "youtube.extraction-failed": {
    openAfter: 2,
    windowMs: 40 * MINUTE,
    clearAfter: 1,
    persistent: false,
  },
  "youtube.cookies-invalid": {
    openAfter: 1,
    windowMs: 0,
    clearAfter: 1,
    persistent: false,
  },
  "youtube.soft-block": {
    openAfter: 1,
    windowMs: 0,
    clearAfter: 1,
    persistent: false,
  },
  "youtube.cookies-expiring": {
    openAfter: 1,
    windowMs: 0,
    clearAfter: 1,
    persistent: false,
  },
  "ytdlp.daemon-fallback": {
    openAfter: 1,
    windowMs: 0,
    clearAfter: 3,
    persistent: false,
  },
  "pot.provider-down": {
    openAfter: 3,
    windowMs: 5 * MINUTE,
    clearAfter: 1,
    persistent: false,
  },
  "ts3.no-talk-power": {
    openAfter: 1,
    windowMs: 0,
    clearAfter: 1,
    persistent: false,
  },
  "ts3.reconnecting": {
    openAfter: 1,
    windowMs: 0,
    clearAfter: 1,
    persistent: false,
    expireAfterMs: 24 * HOUR,
  },
  "process.event-loop-stall": {
    openAfter: 1,
    windowMs: 0,
    clearAfter: 1,
    persistent: true,
    expireAfterMs: 24 * HOUR,
  },
  "process.restart-loop": {
    openAfter: 1,
    windowMs: 0,
    clearAfter: 1,
    persistent: true,
    expireAfterMs: HOUR,
  },
  "panel.bind-exposed": {
    openAfter: 1,
    windowMs: 0,
    clearAfter: 1,
    persistent: false,
  },
  "disk.data-low": {
    openAfter: 1,
    windowMs: 0,
    clearAfter: 1,
    persistent: false,
  },
};

const DETECTORS = new Set(Object.keys(DETECTOR_POLICIES));

// A notice that opened more than FLAP_OPENS times in FLAP_WINDOW_MS stays
// open until its detector has been quiet for FLAP_STABLE_MS, so a flaky
// signal reads as one long notice instead of a stream of open/close pairs.
const FLAP_OPENS = 3;
const FLAP_WINDOW_MS = HOUR;
const FLAP_STABLE_MS = 30 * MINUTE;
const START_HISTORY_MS = HOUR;

export type NoticeTransition =
  | { readonly kind: "opened"; readonly notice: Notice }
  | { readonly kind: "escalated"; readonly notice: Notice }
  | { readonly kind: "resolved"; readonly notice: Notice };

interface Entry {
  key: string;
  detector: NoticeDetector;
  severity: NoticeSeverity;
  titleEs: string;
  detailEs: string;
  data: NoticeData | undefined;
  open: boolean;
  persistent: boolean;
  flapping: boolean;
  firstSeen: number;
  lastSeen: number;
  occurrences: number;
  hits: number[];
  okStreak: number;
  clearRequested: boolean;
}

interface IgnoredEntry {
  readonly severity: NoticeSeverity;
  readonly at: number;
}

interface StoredNotice {
  readonly key: string;
  readonly detector: NoticeDetector;
  readonly severity: NoticeSeverity;
  readonly titleEs: string;
  readonly detailEs: string;
  readonly data?: NoticeData;
  readonly firstSeen: number;
  readonly lastSeen: number;
  readonly occurrences: number;
}

interface StoredFile {
  readonly version: 1;
  readonly notices: readonly StoredNotice[];
  readonly ignored: readonly {
    readonly key: string;
    readonly severity: NoticeSeverity;
    readonly at: number;
  }[];
  readonly starts: readonly number[];
}

export interface NoticeRegistryOptions {
  /** `data/notices.json`; omitted keeps everything in memory. */
  readonly filePath?: string;
  readonly logger?: MinimalLogger;
  readonly now?: () => number;
  readonly policies?: Partial<Record<NoticeDetector, DetectorPolicy>>;
  readonly saveDelayMs?: number;
}

/**
 * Holds what is wrong with the bot right now. Detectors report findings and
 * OK checks; the registry decides when a finding becomes an open notice
 * (threshold per detector), when it resolves (hysteresis, flap guard) and
 * what survives a restart. It never fixes anything.
 */
export class NoticeRegistry {
  readonly #entries = new Map<string, Entry>();
  readonly #ignored = new Map<string, IgnoredEntry>();
  readonly #opens = new Map<string, number[]>();
  readonly #listeners = new Set<(transition: NoticeTransition) => void>();
  readonly #logger: MinimalLogger;
  readonly #now: () => number;
  readonly #policies: Readonly<Record<NoticeDetector, DetectorPolicy>>;
  readonly #filePath: string | undefined;
  readonly #writer: DebouncedWriter | undefined;
  #starts: number[] = [];

  constructor(options: NoticeRegistryOptions = {}) {
    this.#logger = options.logger ?? noopLogger;
    this.#now = options.now ?? Date.now;
    this.#policies = { ...DETECTOR_POLICIES, ...options.policies };
    this.#filePath = options.filePath;
    this.#writer =
      options.filePath === undefined
        ? undefined
        : new DebouncedWriter(() => this.#save(), options.saveDelayMs);
    this.#load();
  }

  onTransition(listener: (transition: NoticeTransition) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  report(finding: Finding): void {
    const now = this.#now();
    const key = noticeKey(finding.detector, finding.subject);
    const policy = this.#policies[finding.detector];
    let entry = this.#entries.get(key);
    if (entry === undefined) {
      entry = {
        key,
        detector: finding.detector,
        severity: finding.severity,
        titleEs: finding.titleEs,
        detailEs: finding.detailEs,
        data: finding.data,
        open: false,
        persistent: finding.persistent ?? policy.persistent,
        flapping: false,
        firstSeen: now,
        lastSeen: now,
        occurrences: 0,
        hits: [],
        okStreak: 0,
        clearRequested: false,
      };
      this.#entries.set(key, entry);
    }
    const previousSeverity = entry.severity;
    entry.severity = finding.severity;
    entry.titleEs = finding.titleEs;
    entry.detailEs = finding.detailEs;
    entry.data = finding.data;
    entry.lastSeen = now;
    entry.occurrences++;
    entry.okStreak = 0;
    entry.clearRequested = false;
    const ignored = this.#ignored.get(key);
    if (
      ignored !== undefined &&
      SEVERITY_RANK[finding.severity] > SEVERITY_RANK[ignored.severity]
    ) {
      this.#ignored.delete(key);
    }
    if (entry.open) {
      if (SEVERITY_RANK[finding.severity] > SEVERITY_RANK[previousSeverity]) {
        this.#emit("escalated", entry);
      }
      this.#persistIf(entry.persistent);
      return;
    }
    entry.hits = entry.hits.filter((at) => now - at < policy.windowMs);
    entry.hits.push(now);
    if (entry.hits.length < policy.openAfter) return;
    entry.open = true;
    entry.hits = [];
    const opens = (this.#opens.get(key) ?? []).filter(
      (at) => now - at < FLAP_WINDOW_MS,
    );
    opens.push(now);
    this.#opens.set(key, opens);
    entry.flapping = opens.length > FLAP_OPENS;
    this.#emit("opened", entry);
    this.#persistIf(entry.persistent);
  }

  /** The detector checked and found nothing wrong. */
  ok(detector: NoticeDetector, subject?: string): void {
    const key = noticeKey(detector, subject);
    const entry = this.#entries.get(key);
    if (entry === undefined) return;
    if (!entry.open) {
      this.#entries.delete(key);
      return;
    }
    entry.okStreak++;
    if (entry.okStreak < this.#policies[detector].clearAfter) return;
    if (entry.flapping && this.#now() - entry.lastSeen < FLAP_STABLE_MS) {
      entry.clearRequested = true;
      return;
    }
    this.#resolve(entry);
  }

  /** Resolves every notice of a detector, whatever its subject. */
  okAll(detector: NoticeDetector): void {
    for (const entry of [...this.#entries.values()]) {
      if (entry.detector !== detector) continue;
      const colon = entry.key.indexOf(":");
      this.ok(detector, colon === -1 ? undefined : entry.key.slice(colon + 1));
    }
  }

  /**
   * Hides a notice until its severity rises. Ignoring does not resolve it:
   * the health verdict and later surfaces skip it, the registry keeps it.
   */
  ignore(key: string): boolean {
    const entry = this.#entries.get(key);
    if (entry === undefined || !entry.open) return false;
    this.#ignored.set(key, { severity: entry.severity, at: this.#now() });
    this.#writer?.schedule();
    return true;
  }

  /** Resolves expired notices and flapping ones that went quiet. */
  sweep(): void {
    const now = this.#now();
    for (const entry of [...this.#entries.values()]) {
      if (!entry.open) {
        const policy = this.#policies[entry.detector];
        if (entry.hits.every((at) => now - at >= policy.windowMs)) {
          this.#entries.delete(entry.key);
        }
        continue;
      }
      const expireAfterMs = this.#policies[entry.detector].expireAfterMs;
      if (
        expireAfterMs !== undefined &&
        now - entry.lastSeen >= expireAfterMs
      ) {
        this.#resolve(entry);
        continue;
      }
      if (entry.clearRequested && now - entry.lastSeen >= FLAP_STABLE_MS) {
        this.#resolve(entry);
      }
    }
  }

  /** Open notices, worst first; pending ones are not shown anywhere. */
  list(): Notice[] {
    return [...this.#entries.values()]
      .filter((entry) => entry.open)
      .map((entry) => this.#toNotice(entry))
      .sort(
        (a, b) =>
          SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
          a.firstSeen - b.firstSeen,
      );
  }

  get(key: string): Notice | undefined {
    const entry = this.#entries.get(key);
    return entry === undefined ? undefined : this.#toNotice(entry);
  }

  /**
   * critical -> unhealthy, error -> degraded, otherwise ok. Ignored notices
   * do not count: the owner already decided they can wait.
   */
  verdict(): HealthVerdict {
    let worst = -1;
    for (const notice of this.list()) {
      if (notice.state === "ignored") continue;
      worst = Math.max(worst, SEVERITY_RANK[notice.severity]);
    }
    if (worst >= SEVERITY_RANK.critical) return "unhealthy";
    if (worst >= SEVERITY_RANK.error) return "degraded";
    return "ok";
  }

  /**
   * Records a process start and returns the starts inside the last hour,
   * this one included, so a crash loop is visible from the next boot.
   */
  recordStart(): readonly number[] {
    const now = this.#now();
    this.#starts = this.#starts.filter((at) => now - at < START_HISTORY_MS);
    this.#starts.push(now);
    this.#writer?.schedule();
    return [...this.#starts];
  }

  async flush(): Promise<void> {
    await this.#writer?.flush();
  }

  #resolve(entry: Entry): void {
    this.#entries.delete(entry.key);
    this.#ignored.delete(entry.key);
    this.#emit("resolved", entry);
    this.#writer?.schedule();
  }

  #persistIf(persistent: boolean): void {
    if (persistent) this.#writer?.schedule();
  }

  #toNotice(entry: Entry): Notice {
    const ignored = this.#ignored.get(entry.key);
    return {
      key: entry.key,
      detector: entry.detector,
      severity: entry.severity,
      titleEs: entry.titleEs,
      detailEs: entry.detailEs,
      ...(entry.data === undefined ? {} : { data: entry.data }),
      state: !entry.open ? "pending" : ignored ? "ignored" : "open",
      persistent: entry.persistent,
      flapping: entry.flapping,
      firstSeen: entry.firstSeen,
      lastSeen: entry.lastSeen,
      occurrences: entry.occurrences,
    };
  }

  #emit(kind: NoticeTransition["kind"], entry: Entry): void {
    const notice = this.#toNotice(entry);
    const fields = {
      key: notice.key,
      severity: notice.severity,
      ...(notice.data === undefined ? {} : { data: notice.data }),
    };
    if (kind === "resolved") {
      this.#logger.info(fields, `Notice resolved: ${notice.titleEs}`);
    } else if (SEVERITY_RANK[notice.severity] >= SEVERITY_RANK.error) {
      this.#logger.error(fields, `Notice ${kind}: ${notice.titleEs}`);
    } else {
      this.#logger.warn(fields, `Notice ${kind}: ${notice.titleEs}`);
    }
    for (const listener of this.#listeners) {
      try {
        listener({ kind, notice });
      } catch (error) {
        this.#logger.error({ err: error }, "Notice listener failed");
      }
    }
  }

  #load(): void {
    if (this.#filePath === undefined) return;
    const stored = readJsonFile(this.#filePath, parseStoredFile, this.#logger);
    if (stored === undefined) return;
    for (const notice of stored.notices) {
      this.#entries.set(notice.key, {
        ...notice,
        data: notice.data,
        open: true,
        persistent: true,
        flapping: false,
        hits: [],
        okStreak: 0,
        clearRequested: false,
      });
    }
    for (const ignored of stored.ignored) {
      this.#ignored.set(ignored.key, {
        severity: ignored.severity,
        at: ignored.at,
      });
    }
    this.#starts = [...stored.starts];
  }

  async #save(): Promise<void> {
    if (this.#filePath === undefined) return;
    const file: StoredFile = {
      version: 1,
      notices: [...this.#entries.values()]
        .filter((entry) => entry.open && entry.persistent)
        .map((entry) => ({
          key: entry.key,
          detector: entry.detector,
          severity: entry.severity,
          titleEs: entry.titleEs,
          detailEs: entry.detailEs,
          ...(entry.data === undefined ? {} : { data: entry.data }),
          firstSeen: entry.firstSeen,
          lastSeen: entry.lastSeen,
          occurrences: entry.occurrences,
        })),
      ignored: [...this.#ignored].map(([key, value]) => ({ key, ...value })),
      starts: this.#starts,
    };
    try {
      await writeJsonFile(this.#filePath, file);
    } catch (error) {
      this.#logger.error({ err: error }, "Could not save notices");
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSeverity(value: unknown): value is NoticeSeverity {
  return typeof value === "string" && Object.hasOwn(SEVERITY_RANK, value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseData(value: unknown): NoticeData | undefined {
  if (!isRecord(value)) return undefined;
  const data: Record<string, string | number | boolean> = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      typeof item === "string" ||
      typeof item === "boolean" ||
      isFiniteNumber(item)
    ) {
      data[key] = item;
    }
  }
  return data;
}

function parseStoredNotice(value: unknown): StoredNotice | undefined {
  if (!isRecord(value)) return undefined;
  const { key, detector, severity, titleEs, detailEs } = value;
  const { firstSeen, lastSeen, occurrences } = value;
  if (
    typeof key !== "string" ||
    typeof detector !== "string" ||
    !DETECTORS.has(detector) ||
    !isSeverity(severity) ||
    typeof titleEs !== "string" ||
    typeof detailEs !== "string" ||
    !isFiniteNumber(firstSeen) ||
    !isFiniteNumber(lastSeen) ||
    !isFiniteNumber(occurrences)
  ) {
    return undefined;
  }
  const data = parseData(value.data);
  return {
    key,
    detector: detector as NoticeDetector,
    severity,
    titleEs,
    detailEs,
    ...(data === undefined ? {} : { data }),
    firstSeen,
    lastSeen,
    occurrences,
  };
}

/**
 * Unknown detectors and malformed entries are dropped one by one, so a
 * notice written by a newer version does not cost the rest of the file.
 */
export function parseStoredFile(raw: unknown): StoredFile | undefined {
  if (!isRecord(raw) || raw.version !== 1) return undefined;
  const notices = Array.isArray(raw.notices)
    ? raw.notices.flatMap((item) => parseStoredNotice(item) ?? [])
    : [];
  const ignored = Array.isArray(raw.ignored)
    ? raw.ignored.flatMap((item) =>
        isRecord(item) &&
        typeof item.key === "string" &&
        isSeverity(item.severity) &&
        isFiniteNumber(item.at)
          ? [{ key: item.key, severity: item.severity, at: item.at }]
          : [],
      )
    : [];
  const starts = Array.isArray(raw.starts)
    ? raw.starts.filter(isFiniteNumber)
    : [];
  return { version: 1, notices, ignored, starts };
}
