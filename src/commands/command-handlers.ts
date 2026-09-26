import type { AppConfig } from "../config.js";
import type { Ts3Connection } from "../adapters/ts3/ts3-connection.js";
import type { RhapsodOpusEncoder } from "../audio/opus-encoder.js";
import { playTestTone } from "../audio/test-tone-player.js";
import type { MetricsCollector } from "../observability/metrics.js";
import type { UserTelemetry } from "../application/user-telemetry.js";
import type { UserPreferences } from "../application/user-preferences.js";
import type { ListeningHistory } from "../application/listening-history.js";
import type { RadioTitleCache } from "../media/radio-icy.js";
import type { SystemYtDlpExecutor } from "../media/youtube/yt-dlp.js";
import type { YoutubePlaybackService } from "../application/youtube-playback-service.js";
import type { ChatCommand } from "./chat-command.js";
import type { CommandRateLimiter } from "./command-rate-limiter.js";
import { searchStations } from "../media/radio-directory.js";
import {
  resolveTuneInStream,
  resolveTuneInUrl,
  searchTuneInStations,
} from "../media/tunein.js";
import { parseMediaInput } from "../media/media-input.js";
import { isAppleMusicPlaylist } from "../media/apple-music.js";
import {
  canMoveBotToChannel,
  canRemoveTracks,
  isAdminUid,
} from "./permissions.js";
import {
  formatHelpCategory,
  formatHelpCommand,
  formatHelpMenu,
} from "./command-registry.js";
import { messages } from "../lib/messages.js";

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
  readonly preferences: UserPreferences;
  readonly listeningHistory: ListeningHistory;
  readonly radioTitles: RadioTitleCache;
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
  const { playback, preferences, verbose } = ctx;
  const { name: senderName, uid: senderUid } = sender;
  if (verbose) await send(messages.playPreparandoLaReproduccion);
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
  } else if (
    media.kind === "apple-music" &&
    isAppleMusicPlaylist(media.value)
  ) {
    const result = await playback.enqueueAppleMusicCollection(
      media.value,
      senderName,
      senderUid,
    );
    const message =
      result.added.length === 0
        ? "La playlist no tiene canciones reproducibles."
        : `Se agregaron ${result.added.length} canciones a la cola${result.remaining ? ` (quedan ${result.remaining} fuera del límite)` : ""}.`;
    await send(message);
  } else if (media.kind === "amazon-music") {
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
    const viaSearch = media.kind === "file";
    if (
      viaSearch &&
      preferences.getPreferredSource(senderUid) === "soundcloud"
    ) {
      const track = await playback.enqueueSoundcloudSearch(
        command.input,
        senderName,
        senderUid,
      );
      await send(messages.playEnColaSoundcloud(track.title));
      return;
    }
    const track = await playback.enqueue(command.input, senderName, senderUid);
    await send(
      messages.playEnCola(track.title, viaSearch ? " (búsqueda)" : ""),
    );
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
  if (verbose) await send(messages.playNextPreparandoLaProximaPista);
  const track = await playback.enqueueNext(
    command.input,
    senderName,
    senderUid,
  );
  await send(messages.playNextProximaEnCola(track.title));
}

async function handleSearch(
  ctx: CommandContext,
  command: Extract<ChatCommand, { name: "search" }>,
  sender: CommandSender,
  send: SendFn,
): Promise<void> {
  const { playback, preferences, verbose } = ctx;
  const { name: senderName, uid: senderUid } = sender;
  if (command.index) {
    const track = await playback.enqueueSearchIndex(
      command.input,
      command.index,
      senderName,
      senderUid,
    );
    await send(messages.searchEnColaResultado(command.index, track.title));
    return;
  }
  if (preferences.getPreferredSource(senderUid) === "soundcloud") {
    const track = await playback.enqueueSoundcloudSearch(
      command.input,
      senderName,
      senderUid,
    );
    await send(messages.searchEnColaSoundcloud(track.title));
    return;
  }
  if (verbose) await send(messages.searchBuscandoEnYoutube);
  const track = await playback.enqueueSearch(
    command.input,
    senderName,
    senderUid,
  );
  await send(messages.searchEnCola(track.title));
}

async function handlePause(
  ctx: CommandContext,
  _command: Extract<ChatCommand, { name: "pause" }>,
  _sender: CommandSender,
  send: SendFn,
): Promise<void> {
  ctx.playback.pause();
  await send(messages.pauseReproduccionPausada);
}

async function handlePrevious(
  ctx: CommandContext,
  _command: Extract<ChatCommand, { name: "previous" }>,
  _sender: CommandSender,
  send: SendFn,
): Promise<void> {
  const track = ctx.playback.replayPrevious();
  await send(messages.previousReproduciendoDeNuevo(track.title));
}

async function handleResume(
  ctx: CommandContext,
  _command: Extract<ChatCommand, { name: "resume" }>,
  _sender: CommandSender,
  send: SendFn,
): Promise<void> {
  ctx.playback.resume();
  await send(messages.resumeReproduccionReanudada);
}

async function handleSeek(
  ctx: CommandContext,
  command: Extract<ChatCommand, { name: "seek" }>,
  _sender: CommandSender,
  send: SendFn,
): Promise<void> {
  ctx.playback.seek(command.seconds);
  await send(messages.seekReproduciendoDesdeElSegundo(command.seconds));
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
      ? messages.queueLaColaEstaVacia
      : page > pages
        ? messages.queueLaColaTienePagina(pages, pages)
        : [
            `Cola de reproducción (página ${page}/${pages}):`,
            ...tracks
              .slice((page - 1) * pageSize, page * pageSize)
              .map(
                (track, index) =>
                  `${(page - 1) * pageSize + index + 1}. ${track.title} (${formatDuration(track.durationSeconds)} - por ${track.requestedBy})`,
              ),
            ...queueEtaFooter(ctx),
          ].join("\n"),
  );
}

function queueEtaFooter(ctx: CommandContext): string[] {
  const tracks = ctx.playback.queue();
  if (tracks.length === 0) return [];
  let remainingMs = 0;
  let unknown = 0;
  for (const track of tracks) {
    if (track.durationSeconds === undefined) unknown++;
    else remainingMs += track.durationSeconds * 1000;
  }
  const current = ctx.playback.current;
  if (
    current?.durationSeconds !== undefined &&
    current.durationSeconds * 1000 > ctx.playback.playbackPositionMs
  ) {
    remainingMs +=
      current.durationSeconds * 1000 - ctx.playback.playbackPositionMs;
  }
  const total = `Faltan ~${formatLongDuration(Math.round(remainingMs / 1000))}`;
  return [
    unknown > 0 ? `${total} (${unknown} sin duración conocida).` : `${total}.`,
  ];
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
      ? messages.historyTodaviaNoSeReprodujo
      : [
          "Historial reciente:",
          ...history.map(
            (track, index) =>
              `${index + 1}. ${track.title} (por ${track.requestedBy})`,
          ),
        ].join("\n"),
  );
}

async function handleFav(
  ctx: CommandContext,
  _command: Extract<ChatCommand, { name: "fav" }>,
  sender: CommandSender,
  send: SendFn,
): Promise<void> {
  const current = ctx.playback.current;
  if (!current) {
    await send(messages.favNoHayNadaSonando);
    return;
  }
  const favorite = ctx.preferences.addFavorite(sender.uid, {
    ...(current.durationSeconds === undefined
      ? {}
      : { durationSeconds: current.durationSeconds }),
    id: current.id,
    source: current.source,
    title: current.title,
  });
  await ctx.preferences.flush();
  await send(messages.favGuardadaEnTusFavoritos(favorite.title));
}

async function handleFavs(
  ctx: CommandContext,
  _command: Extract<ChatCommand, { name: "favs" }>,
  sender: CommandSender,
  send: SendFn,
): Promise<void> {
  const favorites = ctx.preferences.listFavorites(sender.uid);
  await send(
    favorites.length === 0
      ? messages.favsTodaviaNoTenesFavoritos
      : [
          "Tus favoritos:",
          ...favorites.map((track, index) => `${index + 1}. ${track.title}`),
        ].join("\n"),
  );
}

async function handleUnfav(
  ctx: CommandContext,
  command: Extract<ChatCommand, { name: "unfav" }>,
  sender: CommandSender,
  send: SendFn,
): Promise<void> {
  const removed = ctx.preferences.removeFavorite(sender.uid, command.index);
  if (!removed) {
    await send(messages.unfavNoExisteEseFavorito);
    return;
  }
  await ctx.preferences.flush();
  await send(messages.unfavQuitadaDeTusFavoritos(removed.title));
}

async function handleFuente(
  ctx: CommandContext,
  command: Extract<ChatCommand, { name: "fuente" }>,
  sender: CommandSender,
  send: SendFn,
): Promise<void> {
  if (command.source === undefined) {
    const current = ctx.preferences.getPreferredSource(sender.uid);
    await send(messages.fuenteTuFuentePreferidaEs(current));
    return;
  }
  ctx.preferences.setPreferredSource(sender.uid, command.source);
  await ctx.preferences.flush();
  await send(messages.fuenteFuentePreferidaTusBusquedas(command.source));
}

async function handleTops(
  ctx: CommandContext,
  command: Extract<ChatCommand, { name: "tops" }>,
  _sender: CommandSender,
  send: SendFn,
): Promise<void> {
  const limit = Math.min(command.page ?? 5, 10);
  const tops = ctx.listeningHistory.topTracks(limit);
  await send(
    tops.length === 0
      ? messages.topsTodaviaNoHayReproducciones
      : [
          "Top global:",
          ...tops.map(
            (track, index) =>
              `${index + 1}. ${track.title} (${track.plays} ${track.plays === 1 ? "reproducción" : "reproducciones"})`,
          ),
        ].join("\n"),
  );
}

async function handleMyStats(
  ctx: CommandContext,
  _command: Extract<ChatCommand, { name: "mystats" }>,
  sender: CommandSender,
  send: SendFn,
): Promise<void> {
  const summary = ctx.listeningHistory.userSummary(sender.uid);
  const favorites = ctx.preferences.listFavorites(sender.uid).length;
  if (summary.plays === 0 && favorites === 0) {
    await send(messages.myStatsTodaviaNoTenesReproducciones);
    return;
  }
  await send(
    [
      `Tus números: ${summary.plays} reproducciones (${summary.completes} completadas, ${summary.skips} saltadas).`,
      ...(summary.topArtist === undefined
        ? []
        : [`Artista top: ${summary.topArtist}.`]),
      `Favoritos: ${favorites}.`,
    ].join("\n"),
  );
}

async function handleAutoplay(
  ctx: CommandContext,
  command: Extract<ChatCommand, { name: "autoplay" }>,
  _sender: CommandSender,
  send: SendFn,
): Promise<void> {
  if (command.enabled === undefined) {
    await send(
      ctx.playback.autoplayEnabled
        ? messages.autoplayAutoplayActivadoCuandoSe
        : messages.autoplayAutoplayDesactivadoPrendeloCon,
    );
    return;
  }
  ctx.playback.setAutoplay(command.enabled);
  await send(
    command.enabled
      ? messages.autoplayAutoplayActivadoCuandoSe2
      : messages.autoplayAutoplayDesactivado,
  );
}

async function handleRadio(
  ctx: CommandContext,
  command: Extract<ChatCommand, { name: "radio" }>,
  sender: CommandSender,
  send: SendFn,
): Promise<void> {
  // Pasted links never match a name search: TuneIn pages and tun.in short
  // links resolve straight to the station stream. Plain names fail the URL
  // parse with no network, so this stays first for both shapes.
  const tuneInLink = await resolveTuneInUrl(command.input);
  if (tuneInLink !== undefined) {
    await ctx.playback.enqueue(tuneInLink, sender.name, sender.uid);
    await send(messages.radioSintonizando(command.input));
    return;
  }
  const stations = await searchStations(command.input);
  const station = stations.find((candidate) =>
    candidate.url.toLowerCase().startsWith("https://"),
  );
  if (station !== undefined) {
    await ctx.playback.enqueue(station.url, sender.name, sender.uid);
    await send(
      messages.radioSintonizandoKbps(
        station.name,
        station.bitrate ? ` (${station.bitrate} kbps)` : "",
      ),
    );
    return;
  }
  const tuneIn = await searchTuneInStations(command.input);
  const tuneInStation = tuneIn[0];
  const streamUrl =
    tuneInStation === undefined
      ? undefined
      : await resolveTuneInStream(tuneInStation.id);
  if (tuneInStation === undefined || streamUrl === undefined) {
    await send(messages.radioNoEncontreEmisorasPara(command.input));
    return;
  }
  await ctx.playback.enqueue(streamUrl, sender.name, sender.uid);
  await send(
    messages.radioSintonizandoKbps2(
      tuneInStation.name,
      tuneInStation.bitrate ? ` (${tuneInStation.bitrate} kbps)` : "",
    ),
  );
}

async function handleFavPlay(
  ctx: CommandContext,
  command: Extract<ChatCommand, { name: "favplay" }>,
  sender: CommandSender,
  send: SendFn,
): Promise<void> {
  const favorite = ctx.preferences.listFavorites(sender.uid)[command.index - 1];
  if (!favorite) {
    await send(messages.favPlayNoExisteEseFavorito);
    return;
  }
  const track = await ctx.playback.enqueue(
    favorite.source,
    sender.name,
    sender.uid,
  );
  await send(messages.favPlayAgregadaALaCola(track.title));
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
      ? messages.moveMovidaALaPosicion(command.to, moved.title)
      : command.from === command.to
        ? messages.moveLaPistaYaEsta
        : messages.moveNoExisteAlgunaDe,
  );
}

async function handleRemove(
  ctx: CommandContext,
  command: Extract<ChatCommand, { name: "remove" }>,
  sender: CommandSender,
  send: SendFn,
): Promise<void> {
  const { playback } = ctx;
  const selected = playback.queue().slice(command.from - 1, command.to);
  if (!(await senderMayRemove(ctx, sender, selected))) {
    await send(messages.removeSoloElAdministradorDel);
    return;
  }
  const removed = playback.removeQueuedRange(command.from, command.to);
  await send(
    removed.length === 0
      ? messages.removeNoExisteEsaPosicion
      : removed.length === 1
        ? messages.removeQuitadaDeLaCola(removed[0]?.title ?? "")
        : messages.removeSeQuitaronPistasDe(removed.length),
  );
}

/**
 * Ownership check shared by !skip, !remove, !jump, !stop and !clear. The
 * connected-client list is only fetched when the strict rule says no, so
 * the common case costs no TeamSpeak query.
 */
async function senderMayRemove(
  ctx: CommandContext,
  sender: CommandSender,
  tracks: ReadonlyArray<{
    readonly requestedBy: string;
    readonly requestedByUid?: string;
  }>,
): Promise<boolean> {
  const base = {
    adminUids: ctx.adminUids,
    senderName: sender.name,
    senderUid: sender.uid,
    tracks,
  };
  if (canRemoveTracks(base)) return true;
  const connectedUids = await connectedUidsOrUnknown(ctx);
  return (
    connectedUids !== undefined && canRemoveTracks({ ...base, connectedUids })
  );
}

async function connectedUidsOrUnknown(
  ctx: CommandContext,
): Promise<ReadonlySet<string> | undefined> {
  try {
    const uids = await ctx.connection.listConnectedClientUids();
    // The bot itself is always connected: an empty list means the query
    // failed, and treating everyone as gone would make every track communal.
    return uids.length === 0 ? undefined : new Set(uids);
  } catch {
    return undefined;
  }
}

async function handleClear(
  ctx: CommandContext,
  _command: Extract<ChatCommand, { name: "clear" }>,
  sender: CommandSender,
  send: SendFn,
): Promise<void> {
  if (!(await senderMayRemove(ctx, sender, ctx.playback.queue()))) {
    await send(messages.clearLaColaTienePistas);
    return;
  }
  const cleared = ctx.playback.clearQueued();
  await send(
    cleared === 0
      ? messages.clearLaColaYaEstaba
      : messages.clearSeQuitaronPistasDe(cleared),
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
      await send(messages.channelMoveNoEncontreNingunCanal(command.input));
      return;
    }
    if (matches.length > 1) {
      const list = matches
        .slice(0, 5)
        .map((ch) => ch.name)
        .join(", ");
      await send(messages.channelMoveEncontreVariosCanalesSe(list));
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
    await send(messages.channelMoveNoTenesPermisosPara);
    return;
  }
  if (decision === "deny-admin") {
    await send(messages.channelMoveEseCanalRequiereRango);
    return;
  }
  if (decision === "deny-senior") {
    await send(messages.channelMoveEseCanalRequiereRango2);
    return;
  }
  try {
    await connection.moveToChannel(target.cid);
    telemetry.recordBotMovedBy(senderUid);
    const resolvedName =
      numericCid !== undefined
        ? (await connection.getChannelInfo(numericCid)).channel_name
        : undefined;
    await send(messages.channelMoveMovidoAlCanal(resolvedName ?? target.name));
  } catch {
    await send(messages.channelMoveNoPudeMovermeA);
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
      ? messages.shuffleNoHayPistasEn
      : messages.shuffleColaMezcladaPistas(shuffled),
  );
}

async function handleNowPlaying(
  ctx: CommandContext,
  _command: Extract<ChatCommand, { name: "now-playing" }>,
  _sender: CommandSender,
  send: SendFn,
): Promise<void> {
  const current = ctx.playback.current;
  if (!current) {
    await send(messages.nowPlayingNoHayNadaReproduciendose);
    return;
  }
  const liveTitle =
    current.durationSeconds === undefined
      ? await ctx.radioTitles.get(current.source)
      : undefined;
  await send(
    messages.nowPlayingReproduciendoPor(
      liveTitle ?? current.title,
      formatDuration(current.durationSeconds),
      current.requestedBy,
    ),
  );
}

async function handleSkip(
  ctx: CommandContext,
  _command: Extract<ChatCommand, { name: "skip" }>,
  sender: CommandSender,
  send: SendFn,
): Promise<void> {
  const current = ctx.playback.current;
  if (
    current !== undefined &&
    !(await senderMayRemove(ctx, sender, [current]))
  ) {
    await send(messages.skipSoloQuienPidioLa);
    return;
  }
  ctx.playback.skip();
  await send(messages.skipPistaSaltada);
}

async function handleJump(
  ctx: CommandContext,
  command: Extract<ChatCommand, { name: "jump" }>,
  sender: CommandSender,
  send: SendFn,
): Promise<void> {
  const { playback } = ctx;
  const current = playback.current;
  const queued = playback.queue();
  const target = queued[command.index - 1];
  if (target === undefined) {
    await send(messages.jumpNoExisteEsaPosicion);
    return;
  }
  const victims = queued.slice(0, command.index - 1);
  if (current !== undefined) victims.unshift(current);
  if (!(await senderMayRemove(ctx, sender, victims))) {
    await send(messages.jumpSoloQuienPidioLas);
    return;
  }
  playback.jumpTo(command.index);
  await send(messages.jumpSaltandoALaPosicion(command.index, target.title));
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
  await send(messages.statsText(statsOutput, authLine));
}

async function handleDiag(
  ctx: CommandContext,
  _command: Extract<ChatCommand, { name: "diag" }>,
  sender: CommandSender,
  send: SendFn,
): Promise<void> {
  if (!isAdminUid(sender.uid, ctx.adminUids)) {
    await send(messages.diagSoloLosAdministradoresPueden);
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
    await send(messages.debugServerSoloLosAdministradoresPueden);
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
    await send(messages.chartSoloLosAdministradoresPueden);
    return;
  }
  const top = ctx.telemetry.snapshot().slice(0, 20);
  if (top.length === 0) {
    await send(messages.chartTodaviaNoHayDatos);
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
  sender: CommandSender,
  send: SendFn,
): Promise<void> {
  const current = ctx.playback.current;
  if (
    !(await senderMayRemove(ctx, sender, [
      ...(current === undefined ? [] : [current]),
      ...ctx.playback.queue(),
    ]))
  ) {
    await send(messages.stopHayPistasDeOtros);
    return;
  }
  ctx.playback.stop();
  ctx.hasStartedPlaying = false;
  await send(messages.stopReproduccionDetenida);
}

async function handleTestTone(
  ctx: CommandContext,
  _command: Extract<ChatCommand, { name: "test-tone" }>,
  _sender: CommandSender,
  send: SendFn,
): Promise<void> {
  const { playback, commandRateLimiter, encoder, connection } = ctx;
  if (playback.current) {
    await send(messages.testToneNoPuedoReproducirEl);
    return;
  }
  const toneLimit = commandRateLimiter.acquire("global:test-tone", 30_000);
  if (!toneLimit.allowed) {
    if (
      commandRateLimiter.acquire("global:test-tone-feedback", 5_000).allowed
    ) {
      await send(
        messages.testToneElTonoEstaraDisponible(
          Math.ceil(toneLimit.retryAfterMs / 1_000),
        ),
      );
    }
    return;
  }
  await send(messages.testToneReproduciendoTonoDePrueba);
  await playTestTone(3, encoder, connection);
  await send(messages.testToneTonoDePruebaTerminado);
}

async function handleHelp(
  ctx: CommandContext,
  command: Extract<ChatCommand, { name: "help" }>,
  sender: CommandSender,
  send: SendFn,
): Promise<void> {
  const isAdmin = isAdminUid(sender.uid, ctx.adminUids);
  if (command.command !== undefined) {
    await send(formatHelpCommand(command.command, isAdmin));
    return;
  }
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
        ? messages.loopModoLoopDesactivado
        : command.mode === "track"
          ? messages.loopModoLoopPistaActual
          : messages.loopModoLoopColaEn,
    );
  } else {
    await send(messages.loopModoLoopActualUsa(ctx.playback.loopMode));
  }
}

async function handleVolume(
  ctx: CommandContext,
  command: Extract<ChatCommand, { name: "volume" }>,
  _sender: CommandSender,
  send: SendFn,
): Promise<void> {
  ctx.playback.setVolume(command.value);
  await send(messages.volumeVolumenAjustadoA(ctx.playback.volume));
}

async function handleLyrics(
  ctx: CommandContext,
  _command: Extract<ChatCommand, { name: "lyrics" }>,
  _sender: CommandSender,
  send: SendFn,
): Promise<void> {
  if (!ctx.playback.current) {
    await send(messages.lyricsNoHayNadaReproduciendose);
    return;
  }
  await send(messages.lyricsBuscandoLaLetra);
  const lyrics = await ctx.playback.getLyrics();
  if (!lyrics) {
    await send(messages.lyricsNoEncontreLaLetra(ctx.playback.current.title));
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
  await send(messages.lyricsN(title, body));
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
      await send(
        messages.playlistPlaylistGuardadaPistas(command.nameArg, count),
      );
      return;
    }
    case "load": {
      const count = ctx.playback.loadPlaylist(
        command.nameArg,
        sender.name,
        sender.uid,
      );
      await send(messages.playlistCargandoPistas(command.nameArg, count));
      return;
    }
    case "list": {
      const playlists = ctx.playback.listPlaylists(sender.uid);
      if (playlists.length === 0) {
        await send(messages.playlistNoTenesPlaylistsGuardadas);
        return;
      }
      const pageSize = 10;
      const pages = Math.max(1, Math.ceil(playlists.length / pageSize));
      const page = command.page ?? 1;
      if (page > pages) {
        await send(messages.playlistLaListaTienePagina(pages, pages));
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
        await send(messages.playlistNoEncontreLaPlaylist(command.nameArg));
        return;
      }
      if (playlist.tracks.length === 0) {
        await send(messages.playlistLaPlaylistEstaVacia(command.nameArg));
        return;
      }
      const pageSize = 10;
      const pages = Math.max(1, Math.ceil(playlist.tracks.length / pageSize));
      const page = command.page ?? 1;
      if (page > pages) {
        await send(
          messages.playlistLaPlaylistTienePagina(pages, command.nameArg, pages),
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
          ? messages.playlistPlaylistEliminada(command.nameArg)
          : messages.playlistNoEncontreLaPlaylist2(command.nameArg),
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
        await send(messages.playlistNoEncontrePistasEn);
        return;
      }
      await send(
        exists
          ? source === "playlist"
            ? messages.playlistAgregandoPistasDeLa(
                tracks.length,
                command.nameArg,
              )
            : messages.playlistAgregandoPistaSA(tracks.length, command.nameArg)
          : messages.playlistPlaylistCreadaAgregandoPistas(
              command.nameArg,
              tracks.length,
            ),
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
        await send(messages.playlistNoEncontreLaPlaylist3(command.nameArg));
        return;
      }
      if (result.status === "invalid-index") {
        await send(
          messages.playlistIndiceInvalidoLaPlaylist(
            command.nameArg,
            result.total,
          ),
        );
        return;
      }
      await send(
        messages.playlistTrackEliminadoDeTiene(command.nameArg, result.total),
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
        await send(messages.playlistNoEncontreLaPlaylist4(command.oldName));
        return;
      }
      if (result.status === "name-exists") {
        await send(messages.playlistYaExisteUnaPlaylist(result.name));
        return;
      }
      await send(
        messages.playlistPlaylistRenombradaA(command.oldName, command.newName),
      );
      return;
    }
    case "info": {
      const info = ctx.playback.getPlaylistInfo(command.nameArg, sender.uid);
      if (info === undefined) {
        await send(messages.playlistNoEncontreLaPlaylist5(command.nameArg));
        return;
      }
      await send(
        messages.playlistPlaylistPistasDuracionTotal(
          info.name,
          info.trackCount,
          formatLongDuration(info.totalDurationSeconds),
          formatDate(info.createdAt),
        ),
      );
      return;
    }
    default:
      await send(messages.playlistUsaPlaylistSaveLoad);
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
    case "jump":
      return handleJump(ctx, command, sender, send);
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
    case "playlist":
      return handlePlaylist(ctx, command, sender, send);
    case "fav":
      return handleFav(ctx, command, sender, send);
    case "favs":
      return handleFavs(ctx, command, sender, send);
    case "unfav":
      return handleUnfav(ctx, command, sender, send);
    case "favplay":
      return handleFavPlay(ctx, command, sender, send);
    case "fuente":
      return handleFuente(ctx, command, sender, send);
    case "radio":
      return handleRadio(ctx, command, sender, send);
    case "tops":
      return handleTops(ctx, command, sender, send);
    case "mystats":
      return handleMyStats(ctx, command, sender, send);
    case "autoplay":
      return handleAutoplay(ctx, command, sender, send);
  }
}
