type ChatCommand =
  | { readonly name: "channel-move"; readonly input: string }
  | { readonly name: "chart" }
  | { readonly name: "clear" }
  | { readonly name: "debug-server" }
  | { readonly name: "diag" }
  | { readonly name: "help" }
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
  | { readonly name: "volume"; readonly value: number };

const COMMAND_ALIASES: Readonly<Record<string, ChatCommand["name"]>> = {
  c: "clear",
  ch: "channel-move",
  "channel-move": "channel-move",
  chart: "chart",
  clear: "clear",
  diag: "diag",
  ds: "debug-server",
  "debug-server": "debug-server",
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
  prev: "previous",
  previous: "previous",
  q: "queue",
  queue: "queue",
  remove: "remove",
  resume: "resume",
  search: "search",
  rm: "remove",
  s: "skip",
  seek: "seek",
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
  if (!name)
    throw new Error(
      "No reconozco ese comando. Escribí !help para ver los disponibles.",
    );

  const argument = unwrapTeamSpeakUrl(argumentsList.join(" ").trim());
  switch (name) {
    case "channel-move":
      if (!argument)
        throw new Error("Usá: !channel-move <nombre o id del canal>");
      return { input: argument, name };
    case "play":
      if (!argument) throw new Error("Usá: !play <link o término de búsqueda>");
      return { input: argument, name };
    case "search": {
      const first = argument.split(/\s+/)[0] ?? "";
      if (/^\d+$/.test(first)) {
        const index = parsePosition(first, "!yt <n> <búsqueda>");
        const query = argument.split(/\s+/).slice(1).join(" ").trim();
        if (!query) throw new Error("Usá: !yt <n> <búsqueda>");
        return { index, input: query, name };
      }
      if (!argument) throw new Error("Usá: !yt <término de búsqueda>");
      return { input: argument, name };
    }
    case "playnext":
      if (!argument)
        throw new Error("Usá: !playnext <link o término de búsqueda>");
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
    case "seek":
      if (!/^\d+$/.test(argument)) throw new Error("Usá: !seek <segundos>");
      return { name, seconds: Number(argument) };
    default:
      if (argument)
        throw new Error(`El comando !${rawName} no acepta argumentos`);
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
  if (!/^\d+$/.test(argument)) throw new Error(`Usá: ${usage}`);
  const position = Number(argument);
  if (!Number.isSafeInteger(position) || position < 1) {
    throw new Error("La posición tiene que ser mayor a 0.");
  }
  return position;
}

function parseRange(
  argument: string,
  command: "remove",
): { from: number; to: number } {
  const match = argument.match(/^(\d+)(?:-(\d+))?$/);
  if (!match) throw new Error(`Usá: !${command} <posición|desde-hasta>`);
  const from = parsePosition(match[1] ?? "", "!remove <posición|desde-hasta>");
  const to =
    match[2] === undefined
      ? from
      : parsePosition(match[2], "!remove <posición|desde-hasta>");
  if (to < from)
    throw new Error("El rango tiene que ser ascendente (ej: 2-5).");
  return { from, to };
}

function parseMove(argument: string): { from: number; to: number } {
  const parts = argument.split(/\s+/);
  if (parts.length !== 2) throw new Error("Usá: !move <desde> <hasta>");
  const from = parsePosition(parts[0] ?? "", "!move <desde> <hasta>");
  const to = parsePosition(parts[1] ?? "", "!move <desde> <hasta>");
  if (to < from)
    throw new Error("El rango tiene que ser ascendente (ej: 2-5).");
  return { from, to };
}

function parsePage(argument: string): number {
  const page = parsePosition(argument, "!queue [page]");
  return page;
}

function parseVolume(argument: string): number {
  if (!/^\d+$/.test(argument)) throw new Error("Usá: !volume <0-100>");
  const value = Number(argument);
  if (value < 0 || value > 100)
    throw new Error("El volumen tiene que estar entre 0 y 100.");
  return value;
}
