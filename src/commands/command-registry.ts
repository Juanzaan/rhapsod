import { messages } from "../lib/messages.js";
import { UserError } from "../lib/user-error.js";
import type { ChatCommand } from "./chat-command.js";
import {
  noArgument,
  parseAutoplay,
  parseAvisos,
  parseClaim,
  parseFavPlay,
  parseFuente,
  parseJump,
  parseLoop,
  parseMoveCommand,
  parsePlaylist,
  parseQueue,
  parseRemove,
  parseSearch,
  parseSeek,
  parseTops,
  parseUnfav,
  parseVolumeCommand,
  requireInput,
} from "./command-args.js";

export type CommandGroup = "music" | "queue" | "admin" | "misc";

export interface CommandSpec {
  readonly name: ChatCommand["name"];
  readonly aliases: readonly string[];
  readonly group: CommandGroup;
  readonly adminOnly: boolean;
  readonly usage: string;
  readonly summary: string;
}

type CommandName = ChatCommand["name"];

/**
 * One entry per command: what !help and the panel show, and how its
 * argument is parsed. Keyed by name so a command missing from the table,
 * or parsed into another command's shape, fails to compile. Handlers live
 * in command-handlers.ts, which needs the whole runtime; this table stays
 * importable without it.
 */
export interface CommandDefinition<N extends CommandName> extends CommandSpec {
  readonly name: N;
  readonly parse: (
    argument: string,
    rawName: string,
  ) => Extract<ChatCommand, { name: N }>;
}

type CommandTable = { readonly [N in CommandName]: CommandDefinition<N> };

export const COMMANDS: CommandTable = {
  play: {
    name: "play",
    aliases: ["p"],
    group: "music",
    adminOnly: false,
    usage: "play <URL o búsqueda>",
    summary: "Reproducir YouTube, SoundCloud, Spotify, playlists o buscar",
    parse: requireInput("play", messages.parseChatCommandUsaPlayLinkO),
  },
  playnext: {
    name: "playnext",
    aliases: ["pn", "next"],
    group: "music",
    adminOnly: false,
    usage: "playnext <URL o búsqueda>",
    summary: "Agregar como próxima pista",
    parse: requireInput("playnext", messages.parseChatCommandUsaPlaynextLinkO),
  },
  search: {
    name: "search",
    aliases: ["yt", "youtube"],
    group: "music",
    adminOnly: false,
    usage: "yt [n] <búsqueda>",
    summary: "Buscar en YouTube (el resultado n con un número)",
    parse: parseSearch,
  },
  queue: {
    name: "queue",
    aliases: ["q"],
    group: "queue",
    adminOnly: false,
    usage: "queue [página]",
    summary: "Mostrar la cola",
    parse: parseQueue,
  },
  history: {
    name: "history",
    aliases: ["hist"],
    group: "queue",
    adminOnly: false,
    usage: "history",
    summary: "Historial reciente",
    parse: noArgument("history"),
  },
  "now-playing": {
    name: "now-playing",
    aliases: ["np", "now"],
    group: "music",
    adminOnly: false,
    usage: "now-playing",
    summary: "Canción actual",
    parse: noArgument("now-playing"),
  },
  move: {
    name: "move",
    aliases: ["mv"],
    group: "queue",
    adminOnly: false,
    usage: "move <origen> <destino>",
    summary: "Mover una pista",
    parse: parseMoveCommand,
  },
  remove: {
    name: "remove",
    aliases: ["rm"],
    group: "queue",
    adminOnly: false,
    usage: "remove <n|a-b>",
    summary: "Quitar una posición o rango",
    parse: parseRemove,
  },
  clear: {
    name: "clear",
    aliases: ["c"],
    group: "queue",
    adminOnly: false,
    usage: "clear",
    summary: "Vaciar la cola",
    parse: noArgument("clear"),
  },
  shuffle: {
    name: "shuffle",
    aliases: [],
    group: "queue",
    adminOnly: false,
    usage: "shuffle",
    summary: "Mezclar la cola",
    parse: noArgument("shuffle"),
  },
  skip: {
    name: "skip",
    aliases: ["s"],
    group: "music",
    adminOnly: false,
    usage: "skip",
    summary: "Saltar la canción",
    parse: noArgument("skip"),
  },
  previous: {
    name: "previous",
    aliases: ["prev"],
    group: "music",
    adminOnly: false,
    usage: "previous",
    summary: "Repetir la canción anterior",
    parse: noArgument("previous"),
  },
  seek: {
    name: "seek",
    aliases: [],
    group: "music",
    adminOnly: false,
    usage: "seek <segundos>",
    summary: "Saltar a una posición de la canción",
    parse: parseSeek,
  },
  pause: {
    name: "pause",
    aliases: [],
    group: "music",
    adminOnly: false,
    usage: "pause",
    summary: "Pausar la reproducción",
    parse: noArgument("pause"),
  },
  resume: {
    name: "resume",
    aliases: [],
    group: "music",
    adminOnly: false,
    usage: "resume",
    summary: "Continuar la reproducción",
    parse: noArgument("resume"),
  },
  stop: {
    name: "stop",
    aliases: [],
    group: "music",
    adminOnly: false,
    usage: "stop",
    summary: "Detener y vaciar",
    parse: noArgument("stop"),
  },
  "test-tone": {
    name: "test-tone",
    aliases: ["tone"],
    group: "misc",
    adminOnly: false,
    usage: "test-tone",
    summary: "Probar el audio",
    parse: noArgument("test-tone"),
  },
  volume: {
    name: "volume",
    aliases: ["v", "vol"],
    group: "music",
    adminOnly: false,
    usage: "volume <0-100>",
    summary: "Ajustar el volumen",
    parse: parseVolumeCommand,
  },
  loop: {
    name: "loop",
    aliases: [],
    group: "music",
    adminOnly: false,
    usage: "loop [off|track|queue]",
    summary: "Repetir la pista o la cola",
    parse: parseLoop,
  },
  lyrics: {
    name: "lyrics",
    aliases: ["ly"],
    group: "music",
    adminOnly: false,
    usage: "lyrics",
    summary: "Letra de la canción actual",
    parse: noArgument("lyrics"),
  },
  fav: {
    name: "fav",
    aliases: [],
    group: "misc",
    adminOnly: false,
    usage: "fav",
    summary: "Guardar la canción actual en tus favoritos",
    parse: noArgument("fav"),
  },
  favs: {
    name: "favs",
    aliases: [],
    group: "misc",
    adminOnly: false,
    usage: "favs",
    summary: "Ver tus canciones favoritas",
    parse: noArgument("favs"),
  },
  unfav: {
    name: "unfav",
    aliases: [],
    group: "misc",
    adminOnly: false,
    usage: "unfav <n>",
    summary: "Quitar una canción de tus favoritos",
    parse: parseUnfav,
  },
  favplay: {
    name: "favplay",
    aliases: ["fp"],
    group: "misc",
    adminOnly: false,
    usage: "favplay <n>",
    summary: "Agregar un favorito a la cola",
    parse: parseFavPlay,
  },
  fuente: {
    name: "fuente",
    aliases: [],
    group: "misc",
    adminOnly: false,
    usage: "fuente [youtube|soundcloud|auto]",
    summary: "Ver o fijar tu fuente preferida de búsqueda",
    parse: parseFuente,
  },
  radio: {
    name: "radio",
    aliases: ["rb"],
    group: "misc",
    adminOnly: false,
    usage: "radio <nombre, género o link>",
    summary: "Buscar una emisora y sintonizarla",
    parse: requireInput("radio", messages.parseChatCommandUsaRadioNombreGenero),
  },
  jump: {
    name: "jump",
    aliases: ["j"],
    group: "queue",
    adminOnly: false,
    usage: "jump <posición>",
    summary: "Saltar a una posición de la cola",
    parse: parseJump,
  },
  tops: {
    name: "tops",
    aliases: ["top"],
    group: "misc",
    adminOnly: false,
    usage: "tops [n]",
    summary: "Canciones más reproducidas",
    parse: parseTops,
  },
  mystats: {
    name: "mystats",
    aliases: [],
    group: "misc",
    adminOnly: false,
    usage: "mystats",
    summary: "Tus estadísticas de escucha",
    parse: noArgument("mystats"),
  },
  autoplay: {
    name: "autoplay",
    aliases: [],
    group: "music",
    adminOnly: false,
    usage: "autoplay [on|off]",
    summary: "Seguir con temas parecidos al vaciarse la cola",
    parse: parseAutoplay,
  },
  playlist: {
    name: "playlist",
    aliases: ["pl"],
    group: "misc",
    adminOnly: false,
    usage:
      "playlist save|load|list|show|delete|add|remove|rename|info <nombre>",
    summary: "Gestionar playlists guardadas",
    parse: parsePlaylist,
  },
  stats: {
    name: "stats",
    aliases: ["st"],
    group: "misc",
    adminOnly: false,
    usage: "stats",
    summary: "Estado del bot",
    parse: noArgument("stats"),
  },
  "channel-move": {
    name: "channel-move",
    aliases: ["ch"],
    group: "admin",
    adminOnly: true,
    usage: "channel-move <canal>",
    summary: "Mover el bot de canal",
    parse: requireInput(
      "channel-move",
      messages.parseChatCommandUsaChannelMoveNombre,
    ),
  },
  claim: {
    name: "claim",
    aliases: [],
    group: "misc",
    adminOnly: false,
    usage: "claim <código>",
    summary: "Hacerte admin con el código que mostró la instalación",
    parse: parseClaim,
  },
  diag: {
    name: "diag",
    aliases: [],
    group: "admin",
    adminOnly: true,
    usage: "diag",
    summary: "Diagnóstico interno",
    parse: noArgument("diag"),
  },
  "debug-server": {
    name: "debug-server",
    aliases: ["ds"],
    group: "admin",
    adminOnly: true,
    usage: "debug-server",
    summary: "Info del servidor TS3",
    parse: noArgument("debug-server"),
  },
  chart: {
    name: "chart",
    aliases: [],
    group: "admin",
    adminOnly: true,
    usage: "chart",
    summary: "Telemetría de usuarios",
    parse: noArgument("chart"),
  },
  avisos: {
    name: "avisos",
    aliases: ["notices"],
    group: "admin",
    adminOnly: true,
    usage: "avisos [ignorar <n>]",
    summary: "Problemas abiertos del bot",
    parse: parseAvisos,
  },
  help: {
    name: "help",
    aliases: ["h"],
    group: "misc",
    adminOnly: false,
    usage: "help [1-4 | comando]",
    summary: "Mostrar el menú, una categoría o un comando",
    parse: parseHelp,
  },
};

export const COMMAND_SPECS: readonly CommandSpec[] = Object.values(COMMANDS);

const ALIAS_INDEX = new Map<string, ChatCommand["name"]>();
for (const spec of COMMAND_SPECS) {
  ALIAS_INDEX.set(spec.name, spec.name);
  for (const alias of spec.aliases) ALIAS_INDEX.set(alias, spec.name);
}

export function lookupCommandName(
  raw: string,
): ChatCommand["name"] | undefined {
  return ALIAS_INDEX.get(raw.toLowerCase());
}

export const HELP_GROUPS: readonly CommandGroup[] = [
  "music",
  "queue",
  "admin",
  "misc",
];

export const HELP_GROUP_NAMES: Readonly<Record<CommandGroup, string>> = {
  music: "Reproducción",
  queue: "Cola",
  admin: "Administración",
  misc: "Otros",
};

export const HELP_GROUP_SUMMARIES: Readonly<Record<CommandGroup, string>> = {
  music: "Reproducir, buscar, saltar y controlar la canción",
  queue: "Ver, mover y ordenar la cola",
  admin: "Administración y diagnóstico (solo admins)",
  misc: "Efectos, playlists, volumen y más",
};

export function visibleCommandSpecs(isAdmin: boolean): CommandSpec[] {
  return COMMAND_SPECS.filter((spec) => !spec.adminOnly || isAdmin).sort(
    (a, b) => a.name.localeCompare(b.name),
  );
}

export function resolveHelpCategory(
  raw: string | undefined,
): CommandGroup | undefined {
  return matchHelpCategory(raw, true);
}

export type HelpTopic =
  { readonly category: CommandGroup } | { readonly command: string };

/**
 * A number or a full category name wins over a command ("!help cola" is the
 * category), a command or alias wins over a category prefix ("!help c" is
 * !clear, not "cola").
 */
export function resolveHelpTopic(
  raw: string | undefined,
): HelpTopic | undefined {
  const exact = matchHelpCategory(raw, false);
  if (exact !== undefined) return { category: exact };
  const command =
    raw === undefined ? undefined : lookupCommandName(raw.replace(/^!/, ""));
  if (command !== undefined) return { command };
  const prefix = matchHelpCategory(raw, true);
  return prefix === undefined ? undefined : { category: prefix };
}

function matchHelpCategory(
  raw: string | undefined,
  allowPrefix: boolean,
): CommandGroup | undefined {
  if (raw === undefined || raw === "") return undefined;
  const normalized = stripAccents(raw.toLowerCase());
  const index = Number(normalized);
  if (
    Number.isSafeInteger(index) &&
    index >= 1 &&
    index <= HELP_GROUPS.length
  ) {
    return HELP_GROUPS[index - 1];
  }
  return HELP_GROUPS.find((group) => {
    const name = stripAccents(HELP_GROUP_NAMES[group].toLowerCase());
    return (
      group === normalized ||
      name === normalized ||
      (allowPrefix && name.startsWith(normalized))
    );
  });
}

function parseHelp(argument: string): Extract<ChatCommand, { name: "help" }> {
  const topic = resolveHelpTopic(argument);
  if (argument && topic === undefined) {
    throw new UserError(messages.parseChatCommandUsaHelp14);
  }
  return topic === undefined ? { name: "help" } : { ...topic, name: "help" };
}

function stripAccents(input: string): string {
  return input.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function formatHelpMenu(isAdmin: boolean): string {
  const lines = [
    "Comandos disponibles — elegí una opción:",
    "",
    ...HELP_GROUPS.map((group, index) => {
      const count = visibleCommandSpecs(isAdmin).filter(
        (spec) => spec.group === group,
      ).length;
      if (count === 0)
        return `!help ${index + 1} (${HELP_GROUP_NAMES[group]}) — vacío`;
      return `!help ${index + 1} (${HELP_GROUP_NAMES[group]}) — ${HELP_GROUP_SUMMARIES[group]}`;
    }),
    "",
    "Ej: escribí !help 2 para ver los comandos de cola, o !help play para uno solo.",
  ];
  return lines.join("\n");
}

export function formatHelpCategory(
  group: CommandGroup,
  isAdmin: boolean,
): string {
  const specs = visibleCommandSpecs(isAdmin).filter(
    (spec) => spec.group === group,
  );
  if (specs.length === 0) {
    return `No hay comandos en "${HELP_GROUP_NAMES[group]}" para tu nivel.`;
  }
  const lines = [
    `${HELP_GROUP_NAMES[group]}:`,
    "",
    ...specs.map((spec) => {
      const aliasSuffix =
        spec.aliases.length > 0 ? ` (!${spec.aliases.join(", !")})` : "";
      return `!${spec.usage}${aliasSuffix} - ${spec.summary}`;
    }),
    "",
    helpFooter(group, isAdmin),
  ];
  return lines.join("\n");
}

function helpFooter(group: CommandGroup, isAdmin: boolean): string {
  const visible = visibleCommandSpecs(isAdmin);
  const next = HELP_GROUPS.slice(HELP_GROUPS.indexOf(group) + 1).find(
    (candidate) => visible.some((spec) => spec.group === candidate),
  );
  const back = "Usá !help para volver al menú.";
  if (next === undefined) return back;
  const page = HELP_GROUPS.indexOf(next) + 1;
  return `Siguiente: !help ${page} (${HELP_GROUP_NAMES[next]}). ${back}`;
}

/** One command in detail; admin-only commands stay hidden from others. */
export function formatHelpCommand(name: string, isAdmin: boolean): string {
  const spec = COMMAND_SPECS.find((candidate) => candidate.name === name);
  if (spec === undefined || (spec.adminOnly && !isAdmin)) {
    return `No hay ayuda para !${name} en tu nivel. Usá !help para ver el menú.`;
  }
  const page = HELP_GROUPS.indexOf(spec.group) + 1;
  return [
    `!${spec.usage} - ${spec.summary}`,
    ...(spec.aliases.length > 0 ? [`Alias: !${spec.aliases.join(", !")}`] : []),
    `Categoría: ${HELP_GROUP_NAMES[spec.group]} (!help ${page})`,
    ...(spec.adminOnly ? ["Solo admins."] : []),
  ].join("\n");
}
