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
    usage: "help",
    summary: "Mostrar esta ayuda",
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

export function formatHelp(isAdmin: boolean): string {
  const groups: Readonly<Record<CommandGroup, string>> = {
    music: "Reproducción",
    queue: "Cola",
    admin: "Administración",
    misc: "Otros",
  };
  const visible = COMMAND_SPECS.filter(
    (spec) => !spec.adminOnly || isAdmin,
  ).sort((a, b) => a.name.localeCompare(b.name));
  const byGroup = new Map<CommandGroup, CommandSpec[]>();
  for (const spec of visible) {
    const list = byGroup.get(spec.group) ?? [];
    list.push(spec);
    byGroup.set(spec.group, list);
  }
  const lines = ["Comandos disponibles:"];
  for (const group of ["music", "queue", "admin", "misc"] as const) {
    const specs = byGroup.get(group);
    if (specs === undefined || specs.length === 0) continue;
    lines.push(`--- ${groups[group]} ---`);
    for (const spec of specs) {
      const aliasSuffix =
        spec.aliases.length > 0 ? ` (!${spec.aliases.join(", !")})` : "";
      lines.push(`!${spec.usage}${aliasSuffix} - ${spec.summary}`);
    }
  }
  return lines.join("\n");
}
