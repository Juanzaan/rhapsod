import type { AppConfig } from "../config.js";
import type { Ts3Connection } from "../adapters/ts3/ts3-connection.js";
import type { RhapsodOpusEncoder } from "../audio/opus-encoder.js";
import { playTestTone } from "../audio/test-tone-player.js";
import type { MetricsCollector } from "../observability/metrics.js";
import type { UserTelemetry } from "../application/user-telemetry.js";
import type { SystemYtDlpExecutor } from "../media/youtube/yt-dlp.js";
import type { YoutubePlaybackService } from "../application/youtube-playback-service.js";
import type { ChatCommand } from "./chat-command.js";
import type { CommandRateLimiter } from "./command-rate-limiter.js";
import { parseMediaInput } from "../media/media-input.js";
import {
  canMoveBotToChannel,
  canRemoveTrack,
  isAdminUid,
} from "./permissions.js";
import { formatHelpCategory, formatHelpMenu } from "./command-registry.js";
import { FILTER_DISPLAY_NAMES } from "../audio/filter-chain.js";

export interface CommandContext {
  readonly playback: YoutubePlaybackService;
  readonly connection: Ts3Connection;
  readonly config: AppConfig;
  readonly adminUids: ReadonlySet<string>;
  readonly moveGroupIds: ReadonlySet<string>;
  readonly adminGroupIds: ReadonlySet<string>;
  readonly seniorGroupIds: ReadonlySet<string>;
  readonly adminChannelIds: ReadonlySet<number>;
  readonly seniorChannelIds: ReadonlySet<number>;
  readonly metrics: MetricsCollector;
  readonly telemetry: UserTelemetry;
  readonly ytDlpExecutor: SystemYtDlpExecutor;
  readonly commandRateLimiter: CommandRateLimiter;
  readonly encoder: RhapsodOpusEncoder;
  readonly verbose: boolean;
  hasStartedPlaying: boolean;
  youtubeAuthHealthy: boolean;
}

export interface CommandSender {
  readonly name: string;
  readonly uid: string;
  readonly groups: readonly string[];
}

type SendFn = (text: string) => Promise<void>;

function formatDuration(durationSeconds: number | undefined): string {
  if (durationSeconds === undefined) return "duración desconocida";
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatLongDuration(durationSeconds: number): string {
  const hours = Math.floor(durationSeconds / 3600);
  const minutes = Math.round((durationSeconds % 3600) / 60);
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

function formatDate(timestampMs: number): string {
  const date = new Date(timestampMs);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getFullYear()}`;
}

async function handlePlay(
  ctx: CommandContext,
  command: Extract<ChatCommand, { name: "play" }>,
  sender: CommandSender,
  send: SendFn,
): Promise<void> {
  const { playback, verbose } = ctx;
  const { name: senderName, uid: senderUid } = sender;
  if (verbose) await send("Preparando la reproducción...");
  const media = parseMediaInput(command.input);
  if (media.kind === "youtube" && media.resource.type === "playlist") {
    const result = await playback.enqueuePlaylist(
      media.resource,
      senderName,
      senderUid,
    );
    const message =
      result.added.length === 0
        ? "La playlist no tiene canciones reproducibles."
        : `Se agregaron ${result.added.length} canciones a la cola${result.remaining ? ` (quedan ${result.remaining} fuera del límite)` : ""}.`;
    await send(message);
  } else if (media.kind === "spotify" && media.resource.type !== "track") {
    const result = await playback.enqueueSpotifyCollection(
      media.resource,
      senderName,
      senderUid,
    );
    const message =
      result.added.length === 0
        ? "La playlist o álbum no tiene canciones reproducibles."
        : `Se agregaron ${result.added.length} canciones a la cola${result.remaining ? ` (quedan ${result.remaining} fuera del límite)` : ""}.`;
    await send(message);
  } else if (media.kind === "apple-music" || media.kind === "amazon-music") {
    const result = await playback.enqueueMusicLink(
      media.value,
      senderName,
      senderUid,
    );
    const message =
      result.added.length === 0
        ? "No pude encontrar ese link en YouTube o SoundCloud."
        : `Se agregaron ${result.added.length} canciones a la cola${result.remaining ? ` (quedan ${result.remaining} fuera del límite)` : ""}.`;
    await send(message);
  } else {
    const track = await playback.enqueue(command.input, senderName, senderUid);
    const viaSearch = media.kind === "file";
    await send(`En cola: ${track.title}${viaSearch ? " (búsqueda)" : ""}`);
  }
}

async function handlePlayNext(
  ctx: CommandContext,
  command: Extract<ChatCommand, { name: "playnext" }>,
  sender: CommandSender,
  send: SendFn,
): Promise<void> {
  const { playback, verbose } = ctx;
  const { name: senderName, uid: senderUid } = sender;
  if (verbose) await send("Preparando la próxima pista...");
  const track = await playback.enqueueNext(
    command.input,
    senderName,
    senderUid,
  );
  await send(`Próxima en cola: ${track.title}`);
}

async function handleSearch(
  ctx: CommandContext,
  command: Extract<ChatCommand, { name: "search" }>,
  sender: CommandSender,
  send: SendFn,
): Promise<void> {
  const { playback, verbose } = ctx;
  const { name: senderName, uid: senderUid } = sender;
  if (command.index) {
    const track = await playback.enqueueSearchIndex(
      command.input,
      command.index,
      senderName,
      senderUid,
    );
    await send(`En cola (resultado ${command.index}): ${track.title}`);
    return;
  }
  if (verbose) await send("Buscando en YouTube...");
  const track = await playback.enqueueSearch(
    command.input,
    senderName,
    senderUid,
  );
  await send(`En cola: ${track.title}`);
}

async function handlePause(
  ctx: CommandContext,
  _command: Extract<ChatCommand, { name: "pause" }>,
  _sender: CommandSender,
  send: SendFn,
): Promise<void> {
  ctx.playback.pause();
  await send("Reproducción pausada.");
}

async function handlePrevious(
  ctx: CommandContext,
  _command: Extract<ChatCommand, { name: "previous" }>,
  _sender: CommandSender,
  send: SendFn,
): Promise<void> {
  const track = ctx.playback.replayPrevious();
  await send(`Reproduciendo de nuevo: ${track.title}`);
}

async function handleResume(
  ctx: CommandContext,
  _command: Extract<ChatCommand, { name: "resume" }>,
  _sender: CommandSender,
  send: SendFn,
): Promise<void> {
  ctx.playback.resume();
  await send("Reproducción reanudada.");
}

async function handleSeek(
  ctx: CommandContext,
  command: Extract<ChatCommand, { name: "seek" }>,
  _sender: CommandSender,
  send: SendFn,
): Promise<void> {
  ctx.playback.seek(command.seconds);
  await send(`Reproduciendo desde el segundo ${command.seconds}…`);
}

async function handleQueue(
  ctx: CommandContext,
  command: Extract<ChatCommand, { name: "queue" }>,
  _sender: CommandSender,
  send: SendFn,
): Promise<void> {
  const tracks = ctx.playback.queue();
  const pageSize = 10;
  const pages = Math.max(1, Math.ceil(tracks.length / pageSize));
  const page = command.page ?? 1;
  await send(
    tracks.length === 0
      ? "La cola está vacía."
      : page > pages
        ? `La cola tiene ${pages} página(s). Usá !queue ${pages}.`
        : [
            `Cola de reproducción (página ${page}/${pages}):`,
            ...tracks
              .slice((page - 1) * pageSize, page * pageSize)
              .map(
                (track, index) =>
                  `${(page - 1) * pageSize + index + 1}. ${track.title} (${formatDuration(track.durationSeconds)} - por ${track.requestedBy})`,
              ),
          ].join("\n"),
  );
}

async function handleHistory(
  ctx: CommandContext,
  _command: Extract<ChatCommand, { name: "history" }>,
  _sender: CommandSender,
  send: SendFn,
): Promise<void> {
  const history = ctx.playback.history().slice(0, 10);
  await send(
    history.length === 0
      ? "Todavía no se reprodujo ninguna pista."
      : [
          "Historial reciente:",
          ...history.map(
            (track, index) =>
              `${index + 1}. ${track.title} (por ${track.requestedBy})`,
          ),
        ].join("\n"),
  );
}

async function handleMove(
  ctx: CommandContext,
  command: Extract<ChatCommand, { name: "move" }>,
  _sender: CommandSender,
  send: SendFn,
): Promise<void> {
  const moved = ctx.playback.moveQueued(command.from, command.to);
  await send(
    moved
      ? `Movida a la posición ${command.to}: ${moved.title}`
      : command.from === command.to
        ? "La pista ya está en esa posición."
        : "No existe alguna de esas posiciones en la cola.",
  );
}

async function handleRemove(
  ctx: CommandContext,
  command: Extract<ChatCommand, { name: "remove" }>,
  sender: CommandSender,
  send: SendFn,
): Promise<void> {
  const { playback, adminUids } = ctx;
  const { name: senderName, uid: senderUid } = sender;
  const selected = playback.queue().slice(command.from - 1, command.to);
  const unauthorized = selected.some(
    (track) =>
      !canRemoveTrack({
        adminUids,
        requesterName: track.requestedBy,
        ...(track.requestedByUid === undefined
          ? {}
          : { requesterUid: track.requestedByUid }),
        senderName,
        senderUid,
      }),
  );
  if (unauthorized) {
    await send(
      "Solo el administrador del bot puede quitar rangos con pistas de otros usuarios.",
    );
    return;
  }
  const removed = playback.removeQueuedRange(command.from, command.to);
  await send(
    removed.length === 0
      ? "No existe esa posición en la cola."
      : removed.length === 1
        ? `Quitada de la cola: ${removed[0]?.title}`
        : `Se quitaron ${removed.length} pistas de la cola.`,
  );
}

async function handleClear(
  ctx: CommandContext,
  _command: Extract<ChatCommand, { name: "clear" }>,
  _sender: CommandSender,
  send: SendFn,
): Promise<void> {
  const cleared = ctx.playback.clearQueued();
  await send(
    cleared === 0
      ? "La cola ya estaba vacía."
      : `Se quitaron ${cleared} pistas de la cola.`,
  );
}

async function handleChannelMove(
  ctx: CommandContext,
  command: Extract<ChatCommand, { name: "channel-move" }>,
  sender: CommandSender,
  send: SendFn,
): Promise<void> {
  const {
    connection,
    telemetry,
    adminUids,
    moveGroupIds,
    adminGroupIds,
    seniorGroupIds,
    adminChannelIds,
    seniorChannelIds,
  } = ctx;
  const { uid: senderUid, groups: senderGroups } = sender;
  const numericCid = /^\d+$/.test(command.input)
    ? Number(command.input)
    : undefined;
  let target: { readonly cid: number; readonly name: string } | undefined;
  if (numericCid !== undefined) {
    target = { cid: numericCid, name: String(numericCid) };
  } else {
    const channels = await connection.listChannels();
    const query = command.input.toLowerCase();
    const matches = channels.filter((ch) =>
      ch.name.toLowerCase().includes(query),
    );
    if (matches.length === 0) {
      await send(`No encontré ningún canal con "${command.input}".`);
      return;
    }
    if (matches.length > 1) {
      const list = matches
        .slice(0, 5)
        .map((ch) => ch.name)
        .join(", ");
      await send(`Encontré varios canales: ${list}. Sé más específico.`);
      return;
    }
    target = matches[0]!;
  }
  const decision = canMoveBotToChannel({
    senderUid,
    senderGroups,
    adminUids,
    moveGroupIds,
    adminGroupIds,
    seniorGroupIds,
    adminChannelIds,
    seniorChannelIds,
    targetCid: target.cid,
  });
  if (decision === "deny-rank") {
    await send("No tenés permisos para mover el bot de canal.");
    return;
  }
  if (decision === "deny-admin") {
    await send("Ese canal requiere rango Admin o superior.");
    return;
  }
  if (decision === "deny-senior") {
    await send("Ese canal requiere rango Senior Admin o superior.");
    return;
  }
  try {
    await connection.moveToChannel(target.cid);
    telemetry.recordBotMovedBy(senderUid);
    const resolvedName =
      numericCid !== undefined
        ? (await connection.getChannelInfo(numericCid)).channel_name
        : undefined;
    await send(`Movido al canal: ${resolvedName ?? target.name}`);
  } catch {
    await send("No pude moverme a ese canal (¿permisos?).");
  }
}

async function handleShuffle(
  ctx: CommandContext,
  _command: Extract<ChatCommand, { name: "shuffle" }>,
  _sender: CommandSender,
  send: SendFn,
): Promise<void> {
  const shuffled = ctx.playback.shuffleQueued();
  await send(
    shuffled === 0
      ? "No hay pistas en la cola para mezclar."
      : `Cola mezclada (${shuffled} pistas).`,
  );
}

async function handleNowPlaying(
  ctx: CommandContext,
  _command: Extract<ChatCommand, { name: "now-playing" }>,
  _sender: CommandSender,
  send: SendFn,
): Promise<void> {
  await send(
    ctx.playback.current
      ? `Reproduciendo: ${ctx.playback.current.title} (${formatDuration(ctx.playback.current.durationSeconds)} - por ${ctx.playback.current.requestedBy})`
      : "No hay nada reproduciéndose.",
  );
}

async function handleSkip(
  ctx: CommandContext,
  _command: Extract<ChatCommand, { name: "skip" }>,
  _sender: CommandSender,
  send: SendFn,
): Promise<void> {
  ctx.playback.skip();
  await send("Pista saltada.");
}

async function handleStats(
  ctx: CommandContext,
  _command: Extract<ChatCommand, { name: "stats" }>,
  _sender: CommandSender,
  send: SendFn,
): Promise<void> {
  const { playback, metrics, ytDlpExecutor } = ctx;
  const ytdlp = ytDlpExecutor.metrics();
  const current = playback.current;
  const currentArg =
    current !== undefined
      ? {
          title: current.title,
          ...(current.durationSeconds === undefined
            ? {}
            : { durationSeconds: current.durationSeconds }),
        }
      : undefined;
  const statsOutput = metrics.formatStats({
    ...(playback.audioHealth === undefined
      ? {}
      : { audioHealth: playback.audioHealth }),
    ...(currentArg !== undefined ? { current: currentArg } : {}),
    loopMode: playback.loopMode,
    queueLen: playback.queue().length,
    tracksPlayed: playback.tracksPlayed,
    uptimeSec: process.uptime(),
    volume: playback.volume,
    ytdlpActive: ytdlp.active,
    ytdlpQueued: ytdlp.queued,
  });
  const authLine = ctx.youtubeAuthHealthy
    ? ""
    : "\n⚠ Autenticación de YouTube FALLANDO — revisá las cookies del bot.";
  await send(`${statsOutput}${authLine}`);
}

async function handleDiag(
  ctx: CommandContext,
  _command: Extract<ChatCommand, { name: "diag" }>,
  sender: CommandSender,
  send: SendFn,
): Promise<void> {
  if (!isAdminUid(sender.uid, ctx.adminUids)) {
    await send("Solo los administradores pueden usar este comando.");
    return;
  }
  await send(ctx.metrics.formatDiag());
}

async function handleDebugServer(
  ctx: CommandContext,
  _command: Extract<ChatCommand, { name: "debug-server" }>,
  sender: CommandSender,
  send: SendFn,
): Promise<void> {
  if (!isAdminUid(sender.uid, ctx.adminUids)) {
    await send("Solo los administradores pueden usar este comando.");
    return;
  }
  const [serverInfo, clients, channels] = await Promise.all([
    ctx.connection.getServerInfo(),
    ctx.connection.listClients(),
    ctx.connection.listChannels(),
  ]);
  const botClient = clients.find(
    (c) => c.name === ctx.config.RHAPSOD_TS3_NICKNAME,
  );
  const botChannel = channels.find((ch) => ch.cid === (botClient?.cid ?? -1));
  const lines = [
    `=== Server: ${serverInfo.virtualserver_name ?? "?"} ===`,
    `Version: ${serverInfo.virtualserver_version ?? "?"}`,
    `Clients: ${clients.length}/${serverInfo.virtualserver_maxclients ?? "?"}`,
    `Canal del bot: ${botChannel?.name ?? "?"} (cid ${botClient?.cid ?? "?"})`,
    `Talk power del bot: ${botClient?.talkPower ?? "?"}`,
    "",
    `=== Canales (${channels.length}) ===`,
    ...channels.map((ch) => {
      const inChannel = clients.filter((c) => c.cid === ch.cid);
      return `  ${ch.name} (cid ${ch.cid}) [${inChannel.length}]: ${inChannel.map((c) => c.name).join(", ") || "(vacío)"}`;
    }),
  ];
  await send(lines.join("\n"));
}

async function handleChart(
  ctx: CommandContext,
  _command: Extract<ChatCommand, { name: "chart" }>,
  sender: CommandSender,
  send: SendFn,
): Promise<void> {
  if (!isAdminUid(sender.uid, ctx.adminUids)) {
    await send("Solo los administradores pueden usar este comando.");
    return;
  }
  const top = ctx.telemetry.snapshot().slice(0, 20);
  if (top.length === 0) {
    await send("Todavía no hay datos de telemetría de usuarios.");
    return;
  }
  const lines = [
    `=== Telemetría (${ctx.telemetry.snapshot().length} usuarios) ===`,
    ...top.map(
      (u, i) =>
        `${i + 1}. ${u.names[u.names.length - 1] ?? "?"} | grupos [${u.serverGroupIds.join(",")}] | talk ${u.maxTalkPower} | cmds ${u.commandCount} | movió bot ${u.botMovedBy} | entró a canal bot ${u.botChannelEntries}`,
    ),
  ];
  await send(lines.join("\n"));
}

async function handleStop(
  ctx: CommandContext,
  _command: Extract<ChatCommand, { name: "stop" }>,
  _sender: CommandSender,
  send: SendFn,
): Promise<void> {
  ctx.playback.stop();
  ctx.hasStartedPlaying = false;
  await send("Reproducción detenida.");
}

async function handleTestTone(
  ctx: CommandContext,
  _command: Extract<ChatCommand, { name: "test-tone" }>,
  _sender: CommandSender,
  send: SendFn,
): Promise<void> {
  const { playback, commandRateLimiter, encoder, connection } = ctx;
  if (playback.current) {
    await send(
      "No puedo reproducir el tono mientras hay música. Probá con !stop o esperá a que termine la pista.",
    );
    return;
  }
  const toneLimit = commandRateLimiter.acquire("global:test-tone", 30_000);
  if (!toneLimit.allowed) {
    if (
      commandRateLimiter.acquire("global:test-tone-feedback", 5_000).allowed
    ) {
      await send(
        `El tono estará disponible en ${Math.ceil(toneLimit.retryAfterMs / 1_000)} s.`,
      );
    }
    return;
  }
  await send("Reproduciendo tono de prueba (3 s)...");
  await playTestTone(3, encoder, connection);
  await send("Tono de prueba terminado.");
}

async function handleHelp(
  ctx: CommandContext,
  command: Extract<ChatCommand, { name: "help" }>,
  sender: CommandSender,
  send: SendFn,
): Promise<void> {
  const isAdmin = isAdminUid(sender.uid, ctx.adminUids);
  if (command.category === undefined) {
    await send(formatHelpMenu(isAdmin));
    return;
  }
  await send(formatHelpCategory(command.category, isAdmin));
}

async function handleLoop(
  ctx: CommandContext,
  command: Extract<ChatCommand, { name: "loop" }>,
  _sender: CommandSender,
  send: SendFn,
): Promise<void> {
  if (command.mode) {
    ctx.playback.setLoopMode(command.mode);
    await send(
      command.mode === "off"
        ? "Modo loop desactivado."
        : command.mode === "track"
          ? "Modo loop: pista actual en repetición."
          : "Modo loop: cola en repetición.",
    );
  } else {
    await send(
      `Modo loop actual: ${ctx.playback.loopMode}. Usá !loop [off|track|queue].`,
    );
  }
}

async function handleVolume(
  ctx: CommandContext,
  command: Extract<ChatCommand, { name: "volume" }>,
  _sender: CommandSender,
  send: SendFn,
): Promise<void> {
  ctx.playback.setVolume(command.value);
  await send(`Volumen ajustado a ${ctx.playback.volume}%.`);
}

async function handleLyrics(
  ctx: CommandContext,
  _command: Extract<ChatCommand, { name: "lyrics" }>,
  _sender: CommandSender,
  send: SendFn,
): Promise<void> {
  if (!ctx.playback.current) {
    await send("No hay nada reproduciéndose.");
    return;
  }
  await send("Buscando la letra...");
  const lyrics = await ctx.playback.getLyrics();
  if (!lyrics) {
    await send(`No encontré la letra de: ${ctx.playback.current.title}`);
    return;
  }
  const title = lyrics.artist
    ? `${lyrics.artist} - ${lyrics.title}`
    : lyrics.title;
  const maxChars = 1_600;
  const body =
    lyrics.plainLyrics.length > maxChars
      ? `${lyrics.plainLyrics.slice(0, maxChars)}…`
      : lyrics.plainLyrics;
  await send(`${title}\n${body}`);
}

async function handleBassboost(
  ctx: CommandContext,
  command: Extract<ChatCommand, { name: "bassboost" }>,
  _sender: CommandSender,
  send: SendFn,
): Promise<void> {
  const level = command.level;
  ctx.playback.setFilter("bassboost", level === undefined ? {} : { level });
  await send(
    level === undefined
      ? "Filtro bassboost activado."
      : `Filtro bassboost nivel ${level} activado.`,
  );
}

async function handleNightcore(
  ctx: CommandContext,
  command: Extract<ChatCommand, { name: "nightcore" }>,
  _sender: CommandSender,
  send: SendFn,
): Promise<void> {
  ctx.playback.setFilter(
    "nightcore",
    command.rate === undefined ? {} : { rate: command.rate },
  );
  await send("Filtro nightcore activado.");
}

async function handleVaporwave(
  ctx: CommandContext,
  command: Extract<ChatCommand, { name: "vaporwave" }>,
  _sender: CommandSender,
  send: SendFn,
): Promise<void> {
  ctx.playback.setFilter(
    "vaporwave",
    command.rate === undefined ? {} : { rate: command.rate },
  );
  await send("Filtro vaporwave activado.");
}

async function handle8d(
  ctx: CommandContext,
  _command: Extract<ChatCommand, { name: "8d" }>,
  _sender: CommandSender,
  send: SendFn,
): Promise<void> {
  ctx.playback.setFilter("8d");
  await send("Filtro 8D activado.");
}

async function handleFilter(
  ctx: CommandContext,
  command: Extract<ChatCommand, { name: "filter" }>,
  _sender: CommandSender,
  send: SendFn,
): Promise<void> {
  if (command.off) {
    ctx.playback.setFilter("off");
    await send("Filtro desactivado.");
    return;
  }
  await send(`Filtro actual: ${FILTER_DISPLAY_NAMES[ctx.playback.filter]}`);
}

async function handleEffects(
  ctx: CommandContext,
  command: Extract<ChatCommand, { name: "effects" }>,
  sender: CommandSender,
  send: SendFn,
): Promise<void> {
  switch (command.action) {
    case "list": {
      const active = ctx.playback.filter;
      await send(
        active === "off"
          ? "Sin efectos activos."
          : `Efectos activos: ${FILTER_DISPLAY_NAMES[active]}.`,
      );
      return;
    }
    case "reset":
      ctx.playback.setFilter("off");
      await send("Todos los efectos fueron desactivados.");
      return;
    case "test-tone":
      return handleTestTone(ctx, { name: "test-tone" }, sender, send);
    case "chart":
      return handleChart(ctx, { name: "chart" }, sender, send);
    case "on":
    case "off":
    case "toggle": {
      const display = FILTER_DISPLAY_NAMES[command.effect];
      if (command.action === "off") {
        ctx.playback.setFilter("off");
        await send(`Efecto ${display} desactivado.`);
        return;
      }
      const isActive = ctx.playback.filter === command.effect;
      if (command.action === "toggle" && isActive) {
        ctx.playback.setFilter("off");
        await send(`Efecto ${display} desactivado.`);
        return;
      }
      ctx.playback.setFilter(command.effect);
      await send(`Efecto ${display} activado.`);
      return;
    }
    default:
      await send(
        "Efectos: 8d, nightcore, bassboost, vaporwave, test-tone, chart. Usá !effects <efecto> [on|off] para controlar.",
      );
  }
}

async function handlePlaylist(
  ctx: CommandContext,
  command: Extract<ChatCommand, { name: "playlist" }>,
  sender: CommandSender,
  send: SendFn,
): Promise<void> {
  switch (command.action) {
    case "save": {
      const count = ctx.playback.savePlaylist(command.nameArg, sender.uid);
      await send(`Playlist "${command.nameArg}" guardada (${count} pistas).`);
      return;
    }
    case "load": {
      const count = ctx.playback.loadPlaylist(
        command.nameArg,
        sender.name,
        sender.uid,
      );
      await send(`Cargando "${command.nameArg}" (${count} pistas).`);
      return;
    }
    case "list": {
      const playlists = ctx.playback.listPlaylists(sender.uid);
      if (playlists.length === 0) {
        await send("No tenés playlists guardadas.");
        return;
      }
      const pageSize = 10;
      const pages = Math.max(1, Math.ceil(playlists.length / pageSize));
      const page = command.page ?? 1;
      if (page > pages) {
        await send(
          `La lista tiene ${pages} página(s). Usá !playlist list ${pages}.`,
        );
        return;
      }
      await send(
        [
          `Tus playlists (página ${page}/${pages}):`,
          ...playlists
            .slice((page - 1) * pageSize, page * pageSize)
            .map(
              (playlist, index) =>
                `${(page - 1) * pageSize + index + 1}. ${playlist.name} (${playlist.trackCount} pistas)`,
            ),
        ].join("\n"),
      );
      return;
    }
    case "show": {
      const playlist = ctx.playback.showPlaylist(command.nameArg, sender.uid);
      if (playlist === undefined) {
        await send(`No encontré la playlist "${command.nameArg}".`);
        return;
      }
      if (playlist.tracks.length === 0) {
        await send(`La playlist "${command.nameArg}" está vacía.`);
        return;
      }
      const pageSize = 10;
      const pages = Math.max(1, Math.ceil(playlist.tracks.length / pageSize));
      const page = command.page ?? 1;
      if (page > pages) {
        await send(
          `La playlist tiene ${pages} página(s). Usá !playlist show ${command.nameArg} ${pages}.`,
        );
        return;
      }
      await send(
        [
          `Playlist "${command.nameArg}" (página ${page}/${pages}):`,
          ...playlist.tracks
            .slice((page - 1) * pageSize, page * pageSize)
            .map(
              (track, index) =>
                `${(page - 1) * pageSize + index + 1}. ${track.title}`,
            ),
        ].join("\n"),
      );
      return;
    }
    case "delete": {
      const removed = ctx.playback.deletePlaylist(
        command.nameArg,
        sender.uid,
        isAdminUid(sender.uid, ctx.adminUids),
      );
      await send(
        removed
          ? `Playlist "${command.nameArg}" eliminada.`
          : `No encontré la playlist "${command.nameArg}".`,
      );
      return;
    }
    case "add": {
      const exists =
        ctx.playback.showPlaylist(command.nameArg, sender.uid) !== undefined;
      const { source, tracks } = await ctx.playback.resolvePlaylistTracks(
        command.urlArg,
      );
      if (tracks.length === 0) {
        await send("No encontré pistas en esa URL.");
        return;
      }
      await send(
        exists
          ? source === "playlist"
            ? `Agregando ${tracks.length} pistas de la playlist a "${command.nameArg}"...`
            : `Agregando ${tracks.length} pista(s) a "${command.nameArg}"...`
          : `Playlist "${command.nameArg}" creada. Agregando ${tracks.length} pistas...`,
      );
      const result = ctx.playback.addPlaylistTracks(
        command.nameArg,
        tracks,
        sender.uid,
      );
      const verb = result.created ? "creada" : "actualizada";
      let message = `Playlist "${command.nameArg}" ${verb}. Tiene ${result.total} pistas.`;
      if (result.truncated) {
        message = `Playlist "${command.nameArg}" ${verb}. Tiene ${result.total} pistas (límite: 200).`;
      } else if (result.skipped > 0) {
        message = `Playlist "${command.nameArg}" ${verb}. Tiene ${result.total} pistas (${result.skipped} duplicada(s) saltada(s)).`;
      }
      await send(message);
      return;
    }
    case "remove": {
      const result = ctx.playback.removePlaylistTrack(
        command.nameArg,
        command.index,
        sender.uid,
        isAdminUid(sender.uid, ctx.adminUids),
      );
      if (result.status === "not-found") {
        await send(`No encontré la playlist "${command.nameArg}".`);
        return;
      }
      if (result.status === "invalid-index") {
        await send(
          `Índice inválido. La playlist "${command.nameArg}" tiene ${result.total} pistas.`,
        );
        return;
      }
      await send(
        `Track eliminado de "${command.nameArg}". Tiene ${result.total} pistas.`,
      );
      return;
    }
    case "rename": {
      const result = ctx.playback.renamePlaylist(
        command.oldName,
        command.newName,
        sender.uid,
        isAdminUid(sender.uid, ctx.adminUids),
      );
      if (result.status === "not-found") {
        await send(`No encontré la playlist "${command.oldName}".`);
        return;
      }
      if (result.status === "name-exists") {
        await send(`Ya existe una playlist llamada "${result.name}".`);
        return;
      }
      await send(
        `Playlist "${command.oldName}" renombrada a "${command.newName}".`,
      );
      return;
    }
    case "info": {
      const info = ctx.playback.getPlaylistInfo(command.nameArg, sender.uid);
      if (info === undefined) {
        await send(`No encontré la playlist "${command.nameArg}".`);
        return;
      }
      await send(
        `Playlist "${info.name}": ${info.trackCount} pistas, duración total ~${formatLongDuration(info.totalDurationSeconds)}. Creada el ${formatDate(info.createdAt)}.`,
      );
      return;
    }
    default:
      await send(
        "Usá: !playlist save|load|list|show|delete|add|remove|rename|info <nombre>",
      );
  }
}

export async function dispatchCommand(
  ctx: CommandContext,
  command: ChatCommand,
  sender: CommandSender,
  send: SendFn,
): Promise<void> {
  switch (command.name) {
    case "play":
      return handlePlay(ctx, command, sender, send);
    case "playnext":
      return handlePlayNext(ctx, command, sender, send);
    case "search":
      return handleSearch(ctx, command, sender, send);
    case "pause":
      return handlePause(ctx, command, sender, send);
    case "previous":
      return handlePrevious(ctx, command, sender, send);
    case "resume":
      return handleResume(ctx, command, sender, send);
    case "seek":
      return handleSeek(ctx, command, sender, send);
    case "queue":
      return handleQueue(ctx, command, sender, send);
    case "history":
      return handleHistory(ctx, command, sender, send);
    case "move":
      return handleMove(ctx, command, sender, send);
    case "remove":
      return handleRemove(ctx, command, sender, send);
    case "clear":
      return handleClear(ctx, command, sender, send);
    case "channel-move":
      return handleChannelMove(ctx, command, sender, send);
    case "shuffle":
      return handleShuffle(ctx, command, sender, send);
    case "now-playing":
      return handleNowPlaying(ctx, command, sender, send);
    case "skip":
      return handleSkip(ctx, command, sender, send);
    case "stats":
      return handleStats(ctx, command, sender, send);
    case "diag":
      return handleDiag(ctx, command, sender, send);
    case "debug-server":
      return handleDebugServer(ctx, command, sender, send);
    case "chart":
      return handleChart(ctx, command, sender, send);
    case "stop":
      return handleStop(ctx, command, sender, send);
    case "test-tone":
      return handleTestTone(ctx, command, sender, send);
    case "help":
      return handleHelp(ctx, command, sender, send);
    case "loop":
      return handleLoop(ctx, command, sender, send);
    case "volume":
      return handleVolume(ctx, command, sender, send);
    case "lyrics":
      return handleLyrics(ctx, command, sender, send);
    case "bassboost":
      return handleBassboost(ctx, command, sender, send);
    case "nightcore":
      return handleNightcore(ctx, command, sender, send);
    case "vaporwave":
      return handleVaporwave(ctx, command, sender, send);
    case "8d":
      return handle8d(ctx, command, sender, send);
    case "filter":
      return handleFilter(ctx, command, sender, send);
    case "effects":
      return handleEffects(ctx, command, sender, send);
    case "playlist":
      return handlePlaylist(ctx, command, sender, send);
  }
}
