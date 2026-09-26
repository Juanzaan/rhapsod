import { unwrapTeamSpeakUrl } from "./command-args.js";
import {
  COMMANDS,
  lookupCommandName,
  type CommandGroup,
} from "./command-registry.js";
import { UserError } from "../lib/user-error.js";
import { messages } from "../lib/messages.js";

export type ChatCommand =
  | { readonly name: "channel-move"; readonly input: string }
  | { readonly name: "chart" }
  | { readonly name: "clear" }
  | { readonly name: "debug-server" }
  | { readonly name: "diag" }
  | {
      readonly category?: CommandGroup;
      /** Canonical name of the command to explain. */
      readonly command?: string;
      readonly name: "help";
    }
  | { readonly name: "loop"; readonly mode?: "off" | "queue" | "track" }
  | { readonly name: "lyrics" }
  | { readonly input: string; readonly name: "playnext" }
  | { readonly name: "now-playing" }
  | { readonly input: string; readonly name: "play" }
  | { readonly name: "pause" }
  | { readonly name: "previous" }
  | { readonly name: "queue"; readonly page?: number }
  | { readonly name: "remove"; readonly from: number; readonly to: number }
  | { readonly name: "history" }
  | { readonly name: "move"; readonly from: number; readonly to: number }
  | { readonly name: "resume" }
  | { readonly name: "seek"; readonly seconds: number }
  | { readonly index?: number; readonly input: string; readonly name: "search" }
  | { readonly name: "shuffle" }
  | { readonly name: "skip" }
  | { readonly name: "stats" }
  | { readonly name: "stop" }
  | { readonly name: "test-tone" }
  | { readonly name: "volume"; readonly value: number }
  | { readonly name: "fav" }
  | { readonly name: "favs" }
  | { readonly index: number; readonly name: "unfav" }
  | { readonly index: number; readonly name: "favplay" }
  | {
      readonly source?: "auto" | "soundcloud" | "youtube";
      readonly name: "fuente";
    }
  | { readonly input: string; readonly name: "radio" }
  | { readonly index: number; readonly name: "jump" }
  | { readonly page?: number; readonly name: "tops" }
  | { readonly name: "mystats" }
  | { readonly enabled?: boolean; readonly name: "autoplay" }
  | { readonly name: "playlist"; readonly action?: undefined }
  | {
      readonly action: "delete";
      readonly name: "playlist";
      readonly nameArg: string;
    }
  | {
      readonly action: "list";
      readonly name: "playlist";
      readonly page?: number;
    }
  | {
      readonly action: "load";
      readonly name: "playlist";
      readonly nameArg: string;
    }
  | {
      readonly action: "save";
      readonly name: "playlist";
      readonly nameArg: string;
    }
  | {
      readonly action: "show";
      readonly name: "playlist";
      readonly nameArg: string;
      readonly page?: number;
    }
  | {
      readonly action: "add";
      readonly name: "playlist";
      readonly nameArg: string;
      readonly urlArg: string;
    }
  | {
      readonly action: "remove";
      readonly index: number;
      readonly name: "playlist";
      readonly nameArg: string;
    }
  | {
      readonly action: "rename";
      readonly name: "playlist";
      readonly newName: string;
      readonly oldName: string;
    }
  | {
      readonly action: "info";
      readonly name: "playlist";
      readonly nameArg: string;
    };

/**
 * Normalizes raw command input from non-chat callers (e.g. the web panel,
 * which sends bare `stats` instead of `!stats`). Chat messages already
 * carry the prefix and pass through unchanged.
 */
export function normalizeCommandInput(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.startsWith("!")) return trimmed;
  return `!${trimmed}`;
}

/**
 * Commands that still run while the bot cannot talk in its channel. Moving
 * the bot is the way out of a muted channel, so blocking it left no in-chat
 * fix. The handler still applies its own move permissions.
 */
export function runsWithoutTalkPower(command: ChatCommand): boolean {
  return command.name === "channel-move";
}

export function parseChatCommand(
  message: string,
  prefix = "!",
): ChatCommand | undefined {
  if (!message.startsWith(prefix)) return undefined;

  const [rawName = "", ...argumentsList] = message
    .slice(prefix.length)
    .trim()
    .split(/\s+/);
  const name = lookupCommandName(rawName);
  if (!name)
    throw new UserError(messages.parseChatCommandNoReconozcoEseComando);

  return COMMANDS[name].parse(
    unwrapTeamSpeakUrl(argumentsList.join(" ").trim()),
    rawName,
  );
}
