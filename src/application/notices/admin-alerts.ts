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

export interface OnlineClient {
  readonly clid: number;
  readonly uid: string;
}

export interface AdminAlertsOptions {
  readonly registry: Pick<NoticeRegistry, "get" | "list" | "onTransition">;
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
  readonly #lastPaged = new Map<string, number>();
  readonly #paged = new Set<string>();
  #sentAt: number[] = [];
  #pending: Line[] = [];
  #timer: NodeJS.Timeout | undefined;
  #unsubscribe: (() => void) | undefined;

  constructor(options: AdminAlertsOptions) {
    this.#options = options;
    this.#logger = options.logger ?? noopLogger;
    this.#now = options.now ?? Date.now;
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
    const last = this.#lastPaged.get(notice.key);
    const escalated = transition.kind === "escalated";
    if (
      !escalated &&
      last !== undefined &&
      this.#now() - last < NOTICE_RESEND_MS
    ) {
      return;
    }
    this.#pending = this.#pending.filter(
      (line) => line.notice.key !== notice.key,
    );
    this.#pending.push({ kind: "open", notice });
    this.#schedule();
  }

  #stillRelevant(line: Line): boolean {
    if (line.kind === "resolved") return true;
    const current = this.#options.registry.get(line.notice.key);
    return current !== undefined && current.state === "open";
  }

  #schedule(): void {
    if (this.#timer !== undefined) return;
    const timer = setTimeout(() => {
      this.#timer = undefined;
      void this.deliver();
    }, this.#options.coalesceMs ?? COALESCE_MS);
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
