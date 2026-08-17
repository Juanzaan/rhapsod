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
  | { readonly name: "skip" }
  | { readonly name: "stop" }
  | { readonly name: "volume"; readonly value: number };

const COMMAND_ALIASES: Readonly<Record<string, ChatCommand["name"]>> = {
  c: "clear",
  clear: "clear",
  h: "help",
  help: "help",
  loop: "loop",
  np: "now-playing",
  now: "now-playing",
  p: "play",
  pause: "pause",
  play: "play",
  q: "queue",
  queue: "queue",
  remove: "remove",
  resume: "resume",
  rm: "remove",
  s: "skip",
  skip: "skip",
  stop: "stop",
  v: "volume",
  vol: "volume",
  volume: "volume",
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

  const argument = argumentsList.join(" ").trim();
  switch (name) {
    case "play":
      if (!argument) throw new Error("Usage: !play <link or file>");
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
