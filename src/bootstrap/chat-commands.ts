import type { Ts3Connection } from "../adapters/ts3/ts3-connection.js";
import {
  parseChatCommand,
  runsWithoutTalkPower,
} from "../commands/chat-command.js";
import {
  dispatchCommand,
  type CommandContext,
} from "../commands/command-handlers.js";
import { userFacingError } from "../lib/user-facing-error.js";
import type { MinimalLogger } from "../observability/logger.js";

type Respond = (text: string) => Promise<void>;

export interface ChatCommandGateOptions {
  readonly context: CommandContext;
  readonly logger: MinimalLogger;
  readonly maxConcurrent: number;
  readonly privateCommandUids: ReadonlySet<string>;
  /** Whether the bot can speak in its channel; see checkTalkPower in main. */
  readonly canTalk: () => boolean;
  readonly dispatch?: typeof dispatchCommand;
  readonly now?: () => number;
}

export interface IncomingChatMessage {
  readonly message: string;
  readonly senderUid: string;
  readonly senderName: string;
  readonly senderGroups: readonly string[];
  readonly isPrivate: boolean;
  readonly invokerClid: number;
}

const BUSY_FEEDBACK_MS = 5_000;
const RATE_FEEDBACK_MS = 5_000;
const MUTED_FEEDBACK_MS = 10_000;
const PER_USER_COMMAND_GAP_MS = 1_500;

/**
 * Admission for chat commands: a cap on commands running at once, a
 * per-user rate limit and the talk-power gate, each with feedback that is
 * itself rate limited so a burst of commands cannot flood the channel.
 */
export class ChatCommandGate {
  readonly #options: ChatCommandGateOptions;
  readonly #dispatch: typeof dispatchCommand;
  readonly #now: () => number;
  #active = 0;
  #busyFeedbackAt = 0;
  #rateFeedbackAt = 0;
  #mutedFeedbackAt = 0;

  constructor(options: ChatCommandGateOptions) {
    this.#options = options;
    this.#dispatch = options.dispatch ?? dispatchCommand;
    this.#now = options.now ?? Date.now;
  }

  /** Resolves when the command, if one was admitted, has finished. */
  receive(incoming: IncomingChatMessage): Promise<void> {
    const connection: Ts3Connection = this.#options.context.connection;
    const privateAllowed =
      incoming.isPrivate &&
      this.#options.privateCommandUids.has(incoming.senderUid);
    const respond: Respond = privateAllowed
      ? (text) => connection.sendPrivateMessage(incoming.invokerClid, text)
      : (text) => connection.sendChannelMessage(text);
    if (this.#active >= this.#options.maxConcurrent) {
      if (this.#now() - this.#busyFeedbackAt > BUSY_FEEDBACK_MS) {
        this.#busyFeedbackAt = this.#now();
        void respond(
          "El bot está procesando varios pedidos a la vez; probá de nuevo en unos segundos.",
        ).catch(() => undefined);
      }
      return Promise.resolve();
    }
    this.#active++;
    return this.#run(incoming, respond).finally(() => {
      this.#active--;
    });
  }

  async #run(incoming: IncomingChatMessage, respond: Respond): Promise<void> {
    const { context, logger } = this.#options;
    const { message, senderGroups, senderName, senderUid } = incoming;
    try {
      const command = parseChatCommand(message);
      if (!command) return;
      context.telemetry.recordCommand(senderUid);
      if (!this.#options.canTalk() && !runsWithoutTalkPower(command)) {
        if (this.#now() - this.#mutedFeedbackAt > MUTED_FEEDBACK_MS) {
          this.#mutedFeedbackAt = this.#now();
          await context.connection
            .sendChannelMessage(
              "El bot no puede hablar en este canal: solo acepto !channel-move <canal> hasta que me muevan a un canal donde se escuche.",
            )
            .catch(() => undefined);
        }
        return;
      }
      logger.info({ command: message, senderName, senderUid }, "Chat command");
      const rateGate = context.commandRateLimiter.acquire(
        `user:${senderUid}`,
        PER_USER_COMMAND_GAP_MS,
      );
      if (!rateGate.allowed) {
        if (this.#now() - this.#rateFeedbackAt > RATE_FEEDBACK_MS) {
          this.#rateFeedbackAt = this.#now();
          await respond(
            `Esperá un momento entre comandos (${Math.ceil(rateGate.retryAfterMs / 1_000)} s).`,
          );
        }
        return;
      }
      const sender = { groups: senderGroups, name: senderName, uid: senderUid };
      await this.#dispatch(context, command, sender, respond);
    } catch (error) {
      logger.warn(
        { command: message, senderName, senderUid, err: error },
        "Command failed",
      );
      const text =
        error instanceof Error
          ? userFacingError(error)
          : "Error procesando comando";
      await respond(text).catch(() => undefined);
    }
  }
}
