import type { ChatCommand } from "./chat-command.js";

export type CommandGroup = "music" | "queue" | "admin" | "misc";

export interface CommandSpec {
  readonly name: ChatCommand["name"];
  readonly aliases: readonly string[];
  readonly group: CommandGroup;
  readonly adminOnly: boolean;
  readonly usage: string;
  readonly summary: string;
}

export const COMMAND_SPECS: readonly CommandSpec[] = [
  {
    name: "play",
    aliases: ["p"],
    group: "music",
    adminOnly: false,
    usage: "play <URL o búsqueda>",
    summary: "Reproducir YouTube, SoundCloud, Spotify, playlists o buscar",
  },
  {
    name: "playnext",
    aliases: ["pn", "next"],
    group: "music",
    adminOnly: false,
    usage: "playnext <URL o búsqueda>",
    summary: "Agregar como próxima pista",
  },
  {
    name: "search",
    aliases: ["yt", "youtube"],
    group: "music",
    adminOnly: false,
    usage: "yt [n] <búsqueda>",
    summary: "Buscar en YouTube (el resultado n con un número)",
  },
  {
    name: "queue",
    aliases: ["q"],
    group: "queue",
    adminOnly: false,
    usage: "queue [página]",
    summary: "Mostrar la cola",
  },
  {
    name: "history",
    aliases: ["hist"],
    group: "queue",
    adminOnly: false,
    usage: "history",
    summary: "Historial reciente",
  },
  {
    name: "now-playing",
    aliases: ["np", "now"],
    group: "music",
    adminOnly: false,
    usage: "now-playing",
    summary: "Canción actual",
  },
  {
    name: "move",
    aliases: ["mv"],
    group: "queue",
    adminOnly: false,
    usage: "move <origen> <destino>",
    summary: "Mover una pista",
  },
  {
    name: "remove",
    aliases: ["rm"],
    group: "queue",
    adminOnly: false,
    usage: "remove <n|a-b>",
    summary: "Quitar una posición o rango",
  },
  {
    name: "clear",
    aliases: ["c"],
    group: "queue",
    adminOnly: false,
    usage: "clear",
    summary: "Vaciar la cola",
  },
  {
    name: "shuffle",
    aliases: [],
    group: "queue",
    adminOnly: false,
    usage: "shuffle",
    summary: "Mezclar la cola",
  },
  {
    name: "skip",
    aliases: ["s"],
    group: "music",
    adminOnly: false,
    usage: "skip",
    summary: "Saltar la canción",
  },
  {
    name: "previous",
    aliases: ["prev"],
    group: "music",
    adminOnly: false,
    usage: "previous",
    summary: "Repetir la canción anterior",
  },
  {
    name: "seek",
    aliases: [],
    group: "music",
    adminOnly: false,
    usage: "seek <segundos>",
    summary: "Saltar a una posición de la canción",
  },
  {
    name: "pause",
    aliases: [],
    group: "music",
    adminOnly: false,
    usage: "pause",
    summary: "Pausar la reproducción",
  },
  {
    name: "resume",
    aliases: [],
    group: "music",
    adminOnly: false,
    usage: "resume",
    summary: "Continuar la reproducción",
  },
  {
    name: "stop",
    aliases: [],
    group: "music",
    adminOnly: false,
    usage: "stop",
    summary: "Detener y vaciar",
  },
  {
    name: "test-tone",
    aliases: ["tone"],
    group: "misc",
    adminOnly: false,
    usage: "test-tone",
    summary: "Probar el audio",
  },
  {
    name: "volume",
    aliases: ["v", "vol"],
    group: "music",
    adminOnly: false,
    usage: "volume <0-100>",
    summary: "Ajustar el volumen",
  },
  {
    name: "loop",
    aliases: [],
    group: "music",
    adminOnly: false,
    usage: "loop [off|track|queue]",
    summary: "Repetir la pista o la cola",
  },
  {
    name: "lyrics",
    aliases: ["ly"],
    group: "music",
    adminOnly: false,
    usage: "lyrics",
    summary: "Letra de la canción actual",
  },
  {
    name: "bassboost",
    aliases: ["bb"],
    group: "misc",
    adminOnly: false,
    usage: "bassboost [1-5]",
    summary: "Aplicar filtro bassboost",
  },
  {
    name: "nightcore",
    aliases: ["nc"],
    group: "misc",
    adminOnly: false,
    usage: "nightcore [1.05-1.35]",
    summary: "Aplicar filtro nightcore",
  },
  {
    name: "vaporwave",
    aliases: ["vw"],
    group: "misc",
    adminOnly: false,
    usage: "vaporwave [0.80-0.95]",
    summary: "Aplicar filtro vaporwave",
  },
  {
    name: "8d",
    aliases: [],
    group: "misc",
    adminOnly: false,
    usage: "8d",
    summary: "Aplicar filtro 8D",
  },
  {
    name: "filter",
    aliases: [],
    group: "misc",
    adminOnly: false,
    usage: "filter [off]",
    summary: "Ver o desactivar el filtro actual",
  },
  {
    name: "effects",
    aliases: [],
    group: "misc",
    adminOnly: false,
    usage: "effects <efecto> [on|off]",
    summary: "Controlar efectos (8d, nightcore, bassboost, vaporwave)",
  },
  {
    name: "playlist",
    aliases: ["pl"],
    group: "misc",
    adminOnly: false,
    usage:
      "playlist save|load|list|show|delete|add|remove|rename|info <nombre>",
    summary: "Gestionar playlists guardadas",
  },
  {
    name: "stats",
    aliases: ["st"],
    group: "misc",
    adminOnly: false,
    usage: "stats",
    summary: "Estado del bot",
  },
  {
    name: "channel-move",
    aliases: ["ch"],
    group: "admin",
    adminOnly: true,
    usage: "channel-move <canal>",
    summary: "Mover el bot de canal",
  },
  {
    name: "diag",
    aliases: [],
    group: "admin",
    adminOnly: true,
    usage: "diag",
    summary: "Diagnóstico interno",
  },
  {
    name: "debug-server",
    aliases: ["ds"],
    group: "admin",
    adminOnly: true,
    usage: "debug-server",
    summary: "Info del servidor TS3",
  },
  {
    name: "chart",
    aliases: [],
    group: "admin",
    adminOnly: true,
    usage: "chart",
    summary: "Telemetría de usuarios",
  },
  {
    name: "help",
    aliases: ["h"],
    group: "misc",
    adminOnly: false,
    usage: "help [1-4]",
    summary: "Mostrar el menú o los comandos de una categoría",
  },
];

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
      group === normalized || name === normalized || name.startsWith(normalized)
    );
  });
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
    "Ej: escribí !help 2 para ver los comandos de cola.",
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
    "Usá !help para volver al menú.",
  ];
  return lines.join("\n");
}
