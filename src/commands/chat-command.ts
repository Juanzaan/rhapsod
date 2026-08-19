type ChatCommand =
  | { readonly name: "clear" }
  | { readonly name: "help" }
  | { readonly name: "loop"; readonly mode?: "off" | "queue" | "track" }
  | { readonly name: "lyrics" }
  | { readonly input: string; readonly name: "playnext" }
  | { readonly name: "now-playing" }
  | { readonly input: string; readonly name: "play" }
  | { readonly name: "pause" }
  | { readonly name: "queue"; readonly page?: number }
  | { readonly name: "remove"; readonly from: number; readonly to: number }
  | { readonly name: "history" }
  | { readonly name: "move"; readonly from: number; readonly to: number }
  | { readonly name: "resume" }
  | { readonly input: string; readonly name: "search" }
  | { readonly name: "shuffle" }
  | { readonly name: "skip" }
  | { readonly name: "stats" }
  | { readonly name: "stop" }
  | { readonly name: "test-tone" }
  | { readonly name: "volume"; readonly value: number };

const COMMAND_ALIASES: Readonly<Record<string, ChatCommand["name"]>> = {
  c: "clear",
  clear: "clear",
  h: "help",
  help: "help",
  loop: "loop",
  ly: "lyrics",
  lyrics: "lyrics",
  history: "history",
  hist: "history",
  move: "move",
  mv: "move",
  np: "now-playing",
  now: "now-playing",
  "now-playing": "now-playing",
  p: "play",
  pause: "pause",
  play: "play",
  playnext: "playnext",
  pn: "playnext",
  next: "playnext",
  q: "queue",
  queue: "queue",
  remove: "remove",
  resume: "resume",
  search: "search",
  rm: "remove",
  s: "skip",
  shuffle: "shuffle",
  skip: "skip",
  st: "stats",
  stats: "stats",
  stop: "stop",
  "test-tone": "test-tone",
  tone: "test-tone",
  v: "volume",
  vol: "volume",
  volume: "volume",
  yt: "search",
  youtube: "search",
};

export function parseChatCommand(
  message: string,
  prefix = "!",
): ChatCommand | undefined {
  if (!message.startsWith(prefix)) return undefined;

  const [rawName = "", ...argumentsList] = message
    .slice(prefix.length)
    .trim()
    .split(/\s+/);
  const name = COMMAND_ALIASES[rawName.toLowerCase()];
  if (!name) throw new Error(`Unknown command: ${rawName || "(empty)"}`);

  const argument = unwrapTeamSpeakUrl(argumentsList.join(" ").trim());
  switch (name) {
    case "play":
      if (!argument) throw new Error("Usage: !play <URL or search terms>");
      return { input: argument, name };
    case "search":
      if (!argument) throw new Error("Usage: !yt <search terms>");
      return { input: argument, name };
    case "playnext":
      if (!argument) throw new Error("Usage: !playnext <URL or search terms>");
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
        throw new Error("Usage: !loop [off|track|queue]");
      }
      return { mode: argument, name };
    default:
      if (argument)
        throw new Error(`Command !${rawName} does not accept arguments`);
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
  if (!/^\d+$/.test(argument)) throw new Error(`Usage: ${usage}`);
  const position = Number(argument);
  if (!Number.isSafeInteger(position) || position < 1) {
    throw new Error("Queue position must be at least 1");
  }
  return position;
}

function parseRange(
  argument: string,
  command: "remove",
): { from: number; to: number } {
  const match = argument.match(/^(\d+)(?:-(\d+))?$/);
  if (!match) throw new Error(`Usage: !${command} <position|from-to>`);
  const from = parsePosition(match[1] ?? "", "!remove <position|from-to>");
  const to =
    match[2] === undefined
      ? from
      : parsePosition(match[2], "!remove <position|from-to>");
  if (to < from) throw new Error("The range must be ascending");
  return { from, to };
}

function parseMove(argument: string): { from: number; to: number } {
  const parts = argument.split(/\s+/);
  if (parts.length !== 2) throw new Error("Usage: !move <from> <to>");
  return {
    from: parsePosition(parts[0] ?? "", "!move <from> <to>"),
    to: parsePosition(parts[1] ?? "", "!move <from> <to>"),
  };
}

function parsePage(argument: string): number {
  const page = parsePosition(argument, "!queue [page]");
  return page;
}

function parseVolume(argument: string): number {
  if (!/^\d+$/.test(argument)) throw new Error("Usage: !volume <0-100>");
  const value = Number(argument);
  if (value < 0 || value > 100)
    throw new Error("Volume must be between 0 and 100");
  return value;
}
