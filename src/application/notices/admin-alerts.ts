import { noopLogger, type MinimalLogger } from "../../observability/logger.js";
import { SEVERITY_RANK, type Notice } from "./notice.js";
import type { NoticeRegistry, NoticeTransition } from "./notice-registry.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// A notice pages at most once per NOTICE_RESEND_MS, and all admins together
// get at most HOURLY_LIMIT messages an hour: a flapping detector or a burst
// of notices after a network outage must not flood anyone's chat.
const NOTICE_RESEND_MS = 6 * HOUR;
const HOURLY_LIMIT = 5;
// Notices that open together (a reconnect and a failed canary) go out as
// one message instead of several.
const COALESCE_MS = 10_000;
const STARTUP_RECENT_MS = 15 * MINUTE;
// A failed client list (usually a TeamSpeak reconnect) is retried this soon.
const RETRY_MS = MINUTE;

export interface OnlineClient {
  readonly clid: number;
  readonly uid: string;
}

export interface AdminAlertsOptions {
  readonly registry: Pick<NoticeRegistry, "get" | "list" | "onTransition"> &
    Partial<Pick<NoticeRegistry, "alertState" | "saveAlertState">>;
  /** Read on each send: `!claim` adds admins at runtime. */
  readonly adminUids: () => ReadonlySet<string>;
  readonly listClients: () => Promise<readonly OnlineClient[]>;
  readonly sendPrivateMessage: (clid: number, text: string) => Promise<void>;
  readonly logger?: MinimalLogger;
  readonly now?: () => number;
  readonly coalesceMs?: number;
}

type Line =
  | { readonly kind: "open"; readonly notice: Notice }
  | { readonly kind: "resolved"; readonly notice: Notice };

/**
 * Sends error and critical notices to the admins who are online, in a
 * private message, when they open and when they resolve. Listeners never
 * see them: "cookies inválidas" means nothing to them. When no admin is
 * online the message waits for the first admin who enters.
 */
export class AdminAlerts {
  readonly #options: AdminAlertsOptions;
  readonly #logger: MinimalLogger;
  readonly #now: () => number;
  readonly #lastPaged: Map<string, number>;
  readonly #paged: Set<string>;
  #sentAt: number[];
  #pending: Line[] = [];
  #timer: NodeJS.Timeout | undefined;
  #unsubscribe: (() => void) | undefined;

  constructor(options: AdminAlertsOptions) {
    this.#options = options;
    this.#logger = options.logger ?? noopLogger;
    this.#now = options.now ?? Date.now;
    // Loaded from notices.json: a restart must not reset what was sent.
    const saved = options.registry.alertState?.();
    this.#lastPaged = new Map(Object.entries(saved?.lastPaged ?? {}));
    this.#paged = new Set(saved?.paged);
    this.#sentAt = [...(saved?.sentAt ?? [])];
  }

  /**
   * Also queues what opened just before: a notice that the previous
   * process left (event-loop stall, reconnect give-up) or that the startup
   * checks raised. Older persistent notices were already sent last time.
   */
  start(): void {
    const now = this.#now();
    for (const notice of this.#options.registry.list()) {
      if (notice.state !== "open") continue;
      if (SEVERITY_RANK[notice.severity] < SEVERITY_RANK.error) continue;
      if (now - notice.lastSeen > STARTUP_RECENT_MS) continue;
      if (this.#pagedRecently(notice.key)) continue;
      this.#pending.push({ kind: "open", notice });
    }
    if (this.#pending.length > 0) this.#schedule();
    this.#unsubscribe = this.#options.registry.onTransition((transition) => {
      this.#onTransition(transition);
    });
  }

  stop(): void {
    this.#unsubscribe?.();
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  /** Call from onClientEnter: delivers what waited for an admin. */
  adminEntered(uid: string): void {
    if (this.#pending.length === 0) return;
    if (!this.#options.adminUids().has(uid)) return;
    this.#schedule();
  }

  /** Sends what is queued now. Exposed for tests and shutdown. */
  async deliver(): Promise<void> {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
    const lines = this.#pending.filter((line) => this.#stillRelevant(line));
    if (lines.length === 0) {
      this.#pending = [];
      return;
    }
    const now = this.#now();
    this.#sentAt = this.#sentAt.filter((at) => now - at < HOUR);
    if (this.#sentAt.length >= HOURLY_LIMIT) {
      this.#logger.warn(
        { queued: lines.length },
        "Admin notice messages rate-limited; they stay queued",
      );
      this.#pending = lines;
      this.#scheduleIn(Math.max(0, Math.min(...this.#sentAt) + HOUR - now));
      return;
    }
    const admins = this.#options.adminUids();
    let targets: readonly OnlineClient[];
    try {
      targets = (await this.#options.listClients()).filter((client) =>
        admins.has(client.uid),
      );
    } catch (error) {
      this.#logger.warn({ err: error }, "Could not list clients for notices");
      this.#pending = lines;
      this.#scheduleIn(RETRY_MS);
      return;
    }
    if (targets.length === 0) {
      this.#pending = lines;
      return;
    }
    this.#pending = [];
    this.#sentAt.push(now);
    for (const line of lines) {
      if (line.kind === "open") {
        this.#lastPaged.set(line.notice.key, now);
        this.#paged.add(line.notice.key);
      } else {
        this.#paged.delete(line.notice.key);
      }
    }
    this.#options.registry.saveAlertState?.({
      lastPaged: Object.fromEntries(this.#lastPaged),
      paged: [...this.#paged],
      sentAt: this.#sentAt,
    });
    const text = formatAdminAlert(lines);
    await Promise.all(
      targets.map((target) =>
        this.#options
          .sendPrivateMessage(target.clid, text)
          .catch((error: unknown) => {
            this.#logger.warn(
              { err: error, clid: target.clid },
              "Could not send a notice to an admin",
            );
          }),
      ),
    );
  }

  #onTransition(transition: NoticeTransition): void {
    const { notice } = transition;
    if (transition.kind === "resolved") {
      // Only close what an admin was told about; the open line of a
      // notice that resolved before delivery just drops.
      this.#pending = this.#pending.filter(
        (line) => line.notice.key !== notice.key,
      );
      if (this.#paged.has(notice.key)) {
        this.#pending.push({ kind: "resolved", notice });
        this.#schedule();
      }
      return;
    }
    if (SEVERITY_RANK[notice.severity] < SEVERITY_RANK.error) return;
    // A queued resolution of this notice is stale now that it is open again.
    this.#pending = this.#pending.filter(
      (line) => line.notice.key !== notice.key,
    );
    if (transition.kind !== "escalated" && this.#pagedRecently(notice.key))
      return;
    this.#pending.push({ kind: "open", notice });
    this.#schedule();
  }

  /** Paged inside the resend window, by this process or an earlier one. */
  #pagedRecently(key: string): boolean {
    const last = this.#lastPaged.get(key);
    return last !== undefined && this.#now() - last < NOTICE_RESEND_MS;
  }

  #stillRelevant(line: Line): boolean {
    const current = this.#options.registry.get(line.notice.key);
    if (line.kind === "resolved") return current?.state !== "open";
    return current !== undefined && current.state === "open";
  }

  #schedule(): void {
    this.#scheduleIn(this.#options.coalesceMs ?? COALESCE_MS);
  }

  #scheduleIn(delayMs: number): void {
    if (this.#timer !== undefined) return;
    const timer = setTimeout(() => {
      this.#timer = undefined;
      void this.deliver();
    }, delayMs);
    timer.unref();
    this.#timer = timer;
  }
}

const SEVERITY_LABEL: Readonly<Record<Notice["severity"], string>> = {
  info: "Info",
  warning: "Atención",
  error: "Error",
  critical: "Crítico",
};

export function formatAdminAlert(lines: readonly Line[]): string {
  const body = lines.map((line) =>
    line.kind === "open"
      ? `[${SEVERITY_LABEL[line.notice.severity]}] ${line.notice.titleEs}. ${line.notice.detailEs}`
      : `[Resuelto] ${line.notice.titleEs}.`,
  );
  return ["Avisos de Rhapsod:", ...body, "Lista completa: !avisos"].join("\n");
}

export function formatNoticeList(notices: readonly Notice[]): string {
  if (notices.length === 0) return "No hay avisos abiertos.";
  return [
    `Avisos abiertos (${String(notices.length)}):`,
    ...notices.map((notice, index) => {
      const ignored = notice.state === "ignored" ? " (ignorado)" : "";
      return `${String(index + 1)}. [${SEVERITY_LABEL[notice.severity]}]${ignored} ${notice.titleEs}. ${notice.detailEs}`;
    }),
    "Para ocultar uno hasta que empeore: !avisos ignorar <n>",
  ].join("\n");
}
