import {
  lookupCommandName,
  resolveHelpTopic,
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

  const argument = unwrapTeamSpeakUrl(argumentsList.join(" ").trim());
  switch (name) {
    case "channel-move":
      if (!argument)
        throw new UserError(messages.parseChatCommandUsaChannelMoveNombre);
      return { input: argument, name };
    case "play":
      if (!argument) throw new UserError(messages.parseChatCommandUsaPlayLinkO);
      return { input: argument, name };
    case "search": {
      const first = argument.split(/\s+/)[0] ?? "";
      if (/^\d+$/.test(first)) {
        const index = parsePosition(first, "!yt <n> <búsqueda>");
        const query = argument.split(/\s+/).slice(1).join(" ").trim();
        if (!query)
          throw new UserError(messages.parseChatCommandUsaYtNBusqueda);
        return { index, input: query, name };
      }
      if (!argument)
        throw new UserError(messages.parseChatCommandUsaYtTerminoDe);
      return { input: argument, name };
    }
    case "playnext":
      if (!argument)
        throw new UserError(messages.parseChatCommandUsaPlaynextLinkO);
      return { input: argument, name };
    case "queue":
      return argument ? { name, page: parsePage(argument) } : { name };
    case "remove":
      return { name, ...parseRange(argument, "remove") };
    case "move":
      return { name, ...parseMove(argument) };
    case "volume":
      return { name, value: parseVolume(argument) };
    case "loop":
      if (!argument) return { name };
      if (argument !== "off" && argument !== "queue" && argument !== "track") {
        throw new UserError(messages.parseChatCommandUsageLoopOffTrack);
      }
      return { mode: argument, name };
    case "seek":
      if (!/^\d+$/.test(argument))
        throw new UserError(messages.parseChatCommandUsaSeekSegundos);
      return { name, seconds: Number(argument) };
    case "unfav":
      return { name, index: parsePosition(argument, "!unfav <n>") };
    case "favplay":
      return { name, index: parsePosition(argument, "!favplay <n>") };
    case "fuente": {
      if (!argument) return { name };
      if (
        argument !== "youtube" &&
        argument !== "soundcloud" &&
        argument !== "auto"
      ) {
        throw new UserError(
          messages.parseChatCommandUsaFuenteYoutubeSoundcloud,
        );
      }
      return { name, source: argument };
    }
    case "radio":
      if (!argument)
        throw new UserError(messages.parseChatCommandUsaRadioNombreGenero);
      return { input: argument, name };
    case "jump":
      return { name, index: parsePosition(argument, "!jump <posición>") };
    case "tops":
      return argument
        ? { name, page: parsePage(argument, "!tops [n]") }
        : { name };
    case "autoplay": {
      if (!argument) return { name };
      if (argument !== "on" && argument !== "off") {
        throw new UserError(messages.parseChatCommandUsaAutoplayOnOff);
      }
      return { enabled: argument === "on", name };
    }
    case "playlist": {
      const parts = argument.split(/\s+/).filter(Boolean);
      const action = parts[0];
      if (!action) return { name };
      if (action === "list") {
        return parts[1] === undefined
          ? { name, action: "list" }
          : { name, action: "list", page: parsePage(parts[1]) };
      }
      if (
        action === "save" ||
        action === "load" ||
        action === "delete" ||
        action === "show" ||
        action === "info"
      ) {
        const nameArg = parts[1];
        if (!nameArg) {
          throw new UserError(
            messages.parseChatCommandUsaPlaylistNombre(action),
          );
        }
        if (action === "show") {
          return parts[2] === undefined
            ? { name, action, nameArg }
            : { name, action, nameArg, page: parsePage(parts[2]) };
        }
        return { name, action, nameArg };
      }
      if (action === "add") {
        const nameArg = parts[1];
        const urlArg = unwrapTeamSpeakUrl(parts.slice(2).join(" ").trim());
        if (!nameArg || !urlArg) {
          throw new UserError(messages.parseChatCommandUsaPlaylistAddNombre);
        }
        return { name, action: "add", nameArg, urlArg };
      }
      if (action === "remove") {
        const nameArg = parts[1];
        const rawIndex = parts[2];
        if (!nameArg || rawIndex === undefined) {
          throw new UserError(messages.parseChatCommandUsaPlaylistRemoveNombre);
        }
        return {
          name,
          action: "remove",
          nameArg,
          index: parsePosition(rawIndex, "!playlist remove <nombre> <índice>"),
        };
      }
      if (action === "rename") {
        const oldName = parts[1];
        const newName = parts[2];
        if (!oldName || !newName) {
          throw new UserError(messages.parseChatCommandUsaPlaylistRenameViejo);
        }
        return { name, action: "rename", oldName, newName };
      }
      throw new UserError(messages.parseChatCommandUsaPlaylistSaveLoad);
    }
    case "help": {
      const topic = resolveHelpTopic(argument);
      if (argument && topic === undefined) {
        throw new UserError(messages.parseChatCommandUsaHelp14);
      }
      return topic === undefined ? { name } : { ...topic, name };
    }
    default:
      if (argument)
        throw new UserError(
          messages.parseChatCommandElComandoNoAcepta(rawName),
        );
      return { name };
  }
}

function unwrapTeamSpeakUrl(argument: string): string {
  const wrappedUrl = argument.match(/^\[url\](https?:\/\/[^\]]+)\[\/url\]$/i);
  if (wrappedUrl?.[1]) return wrappedUrl[1];

  const labeledUrl = argument.match(
    /^\[url=(https?:\/\/[^\]]+)\].*\[\/url\]$/i,
  );
  return labeledUrl?.[1] ?? argument;
}

function parsePosition(
  argument: string,
  usage = "!remove <queue position>",
): number {
  if (!/^\d+$/.test(argument))
    throw new UserError(messages.parsePositionUsa(usage));
  const position = Number(argument);
  if (!Number.isSafeInteger(position) || position < 1) {
    throw new UserError(messages.parsePositionLaPosicionTieneQue);
  }
  return position;
}

function parseRange(
  argument: string,
  command: "remove",
): { from: number; to: number } {
  const match = argument.match(/^(\d+)(?:-(\d+))?$/);
  if (!match)
    throw new UserError(messages.parseRangeUsaPosicionDesdeHasta(command));
  const from = parsePosition(match[1] ?? "", "!remove <posición|desde-hasta>");
  const to =
    match[2] === undefined
      ? from
      : parsePosition(match[2], "!remove <posición|desde-hasta>");
  if (to < from) throw new UserError(messages.parseRangeElRangoTieneQue);
  return { from, to };
}

function parseMove(argument: string): { from: number; to: number } {
  const parts = argument.split(/\s+/);
  if (parts.length !== 2)
    throw new UserError(messages.parseMoveUsaMoveDesdeHasta);
  const from = parsePosition(parts[0] ?? "", "!move <desde> <hasta>");
  const to = parsePosition(parts[1] ?? "", "!move <desde> <hasta>");
  return { from, to };
}

function parsePage(argument: string, usage = "!queue [page]"): number {
  const page = parsePosition(argument, usage);
  return page;
}

function parseVolume(argument: string): number {
  if (!/^\d+$/.test(argument))
    throw new UserError(messages.parseVolumeUsaVolume0100);
  const value = Number(argument);
  if (value < 0 || value > 100)
    throw new UserError(messages.parseVolumeElVolumenTieneQue);
  return value;
}
