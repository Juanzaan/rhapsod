export type ChatCommand =
  | { readonly name: "clear" }
  | { readonly name: "help" }
  | { readonly name: "loop"; readonly mode?: "off" | "queue" | "track" }
  | { readonly name: "now-playing" }
  | { readonly input: string; readonly name: "play" }
  | { readonly name: "pause" }
  | { readonly name: "queue" }
  | { readonly name: "remove"; readonly position: number }
  | { readonly name: "resume" }
  | { readonly input: string; readonly name: "search" }
  | { readonly name: "skip" }
  | { readonly name: "stop" }
  | { readonly name: "test-tone" }
  | { readonly name: "volume"; readonly value: number };

const COMMAND_ALIASES: Readonly<Record<string, ChatCommand["name"]>> = {
  c: "clear",
  clear: "clear",
  h: "help",
  help: "help",
  loop: "loop",
  np: "now-playing",
  now: "now-playing",
  "now-playing": "now-playing",
  p: "play",
  pause: "pause",
  play: "play",
  q: "queue",
  queue: "queue",
  remove: "remove",
  resume: "resume",
  search: "search",
  rm: "remove",
  s: "skip",
  skip: "skip",
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
      if (!argument) throw new Error("Usage: !play <YouTube URL>");
      return { input: argument, name };
    case "search":
      if (!argument) throw new Error("Usage: !yt <search terms>");
      return { input: argument, name };
    case "remove":
      return { name, position: parsePosition(argument) };
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

function parsePosition(argument: string): number {
  if (!/^\d+$/.test(argument))
    throw new Error("Usage: !remove <queue position>");
  const position = Number(argument);
  if (!Number.isSafeInteger(position) || position < 1) {
    throw new Error("Queue position must be at least 1");
  }
  return position;
}

function parseVolume(argument: string): number {
  if (!/^\d+$/.test(argument)) throw new Error("Usage: !volume <0-100>");
  const value = Number(argument);
  if (value < 0 || value > 100)
    throw new Error("Volume must be between 0 and 100");
  return value;
}
