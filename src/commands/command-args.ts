import { messages } from "../lib/messages.js";
import { UserError } from "../lib/user-error.js";
import type { ChatCommand } from "./chat-command.js";

type CommandOf<N extends ChatCommand["name"]> = Extract<
  ChatCommand,
  { name: N }
>;

/** Commands that take no argument reject one instead of ignoring it. */
export function noArgument<N extends ChatCommand["name"]>(
  name: N,
): (argument: string, rawName: string) => { readonly name: N } {
  return (argument, rawName) => {
    if (argument)
      throw new UserError(messages.parseChatCommandElComandoNoAcepta(rawName));
    return { name };
  };
}

export function requireInput<
  N extends "channel-move" | "play" | "playnext" | "radio",
>(name: N, usage: string): (argument: string) => CommandOf<N> {
  return (argument) => {
    if (!argument) throw new UserError(usage);
    return { input: argument, name } as CommandOf<N>;
  };
}

export function parseClaim(argument: string): CommandOf<"claim"> {
  if (!argument) throw new UserError(messages.parseChatCommandUsaClaimCodigo);
  return { code: argument, name: "claim" };
}

export function parseAvisos(argument: string): CommandOf<"avisos"> {
  if (!argument) return { name: "avisos" };
  const [action, position, ...rest] = argument.split(/\s+/);
  if (action !== "ignorar" || position === undefined || rest.length > 0) {
    throw new UserError(messages.parseChatCommandUsaAvisos);
  }
  return {
    ignore: parsePosition(position, "!avisos ignorar <n>"),
    name: "avisos",
  };
}

export function parseSearch(argument: string): CommandOf<"search"> {
  const first = argument.split(/\s+/)[0] ?? "";
  if (/^\d+$/.test(first)) {
    const index = parsePosition(first, "!yt <n> <búsqueda>");
    const query = argument.split(/\s+/).slice(1).join(" ").trim();
    if (!query) throw new UserError(messages.parseChatCommandUsaYtNBusqueda);
    return { index, input: query, name: "search" };
  }
  if (!argument) throw new UserError(messages.parseChatCommandUsaYtTerminoDe);
  return { input: argument, name: "search" };
}

export function parseQueue(argument: string): CommandOf<"queue"> {
  return argument
    ? { name: "queue", page: parsePage(argument) }
    : { name: "queue" };
}

export function parseRemove(argument: string): CommandOf<"remove"> {
  return { name: "remove", ...parseRange(argument, "remove") };
}

export function parseMoveCommand(argument: string): CommandOf<"move"> {
  return { name: "move", ...parseMove(argument) };
}

export function parseVolumeCommand(argument: string): CommandOf<"volume"> {
  return { name: "volume", value: parseVolume(argument) };
}

export function parseLoop(argument: string): CommandOf<"loop"> {
  if (!argument) return { name: "loop" };
  if (argument !== "off" && argument !== "queue" && argument !== "track") {
    throw new UserError(messages.parseChatCommandUsageLoopOffTrack);
  }
  return { mode: argument, name: "loop" };
}

export function parseSeek(argument: string): CommandOf<"seek"> {
  if (!/^\d+$/.test(argument))
    throw new UserError(messages.parseChatCommandUsaSeekSegundos);
  return { name: "seek", seconds: Number(argument) };
}

export function parseUnfav(argument: string): CommandOf<"unfav"> {
  return { index: parsePosition(argument, "!unfav <n>"), name: "unfav" };
}

export function parseFavPlay(argument: string): CommandOf<"favplay"> {
  return { index: parsePosition(argument, "!favplay <n>"), name: "favplay" };
}

export function parseFuente(argument: string): CommandOf<"fuente"> {
  if (!argument) return { name: "fuente" };
  if (
    argument !== "youtube" &&
    argument !== "soundcloud" &&
    argument !== "auto"
  ) {
    throw new UserError(messages.parseChatCommandUsaFuenteYoutubeSoundcloud);
  }
  return { name: "fuente", source: argument };
}

export function parseJump(argument: string): CommandOf<"jump"> {
  return { index: parsePosition(argument, "!jump <posición>"), name: "jump" };
}

export function parseTops(argument: string): CommandOf<"tops"> {
  return argument
    ? { name: "tops", page: parsePage(argument, "!tops [n]") }
    : { name: "tops" };
}

export function parseAutoplay(argument: string): CommandOf<"autoplay"> {
  if (!argument) return { name: "autoplay" };
  if (argument !== "on" && argument !== "off") {
    throw new UserError(messages.parseChatCommandUsaAutoplayOnOff);
  }
  return { enabled: argument === "on", name: "autoplay" };
}

export function parsePlaylist(argument: string): CommandOf<"playlist"> {
  const name = "playlist";
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
      throw new UserError(messages.parseChatCommandUsaPlaylistNombre(action));
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

export function unwrapTeamSpeakUrl(argument: string): string {
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
  return parsePosition(argument, usage);
}

function parseVolume(argument: string): number {
  if (!/^\d+$/.test(argument))
    throw new UserError(messages.parseVolumeUsaVolume0100);
  const value = Number(argument);
  if (value < 0 || value > 100)
    throw new UserError(messages.parseVolumeElVolumenTieneQue);
  return value;
}
