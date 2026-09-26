export function formatPlaybackStarted(title: string, isFirst: boolean): string {
  return isFirst ? `Reproduciendo: ${title}` : `Ahora: ${title}`;
}

export function formatPlaybackError(title: string): string {
  const truncated = title.length > 40 ? `${title.slice(0, 39)}\u2026` : title;
  return `No pude reproducir "${truncated}". Se intentar\u00e1 continuar con la siguiente canci\u00f3n.`;
}

/**
 * Every chat-facing text in one catalog: a second language is a second
 * object of type `Messages`. Keys are grouped by where the text is used.
 */
export const messages = {
  // Command replies
  playPreparandoLaReproduccion: "Preparando la reproducción...",
  playEnColaSoundcloud: (title: string | number): string =>
    `En cola (SoundCloud): ${title}`,
  playEnCola: (title: string | number, value2: string | number): string =>
    `En cola: ${title}${value2}`,
  playNextPreparandoLaProximaPista: "Preparando la próxima pista...",
  playNextProximaEnCola: (title: string | number): string =>
    `Próxima en cola: ${title}`,
  searchEnColaResultado: (
    index: string | number,
    title: string | number,
  ): string => `En cola (resultado ${index}): ${title}`,
  searchEnColaSoundcloud: (title: string | number): string =>
    `En cola (SoundCloud): ${title}`,
  searchBuscandoEnYoutube: "Buscando en YouTube...",
  searchEnCola: (title: string | number): string => `En cola: ${title}`,
  pauseReproduccionPausada: "Reproducción pausada.",
  previousReproduciendoDeNuevo: (title: string | number): string =>
    `Reproduciendo de nuevo: ${title}`,
  resumeReproduccionReanudada: "Reproducción reanudada.",
  seekReproduciendoDesdeElSegundo: (seconds: string | number): string =>
    `Reproduciendo desde el segundo ${seconds}…`,
  queueLaColaEstaVacia: "La cola está vacía.",
  queueLaColaTienePagina: (
    pages: string | number,
    pages2: string | number,
  ): string => `La cola tiene ${pages} página(s). Usá !queue ${pages2}.`,
  historyTodaviaNoSeReprodujo: "Todavía no se reprodujo ninguna pista.",
  favNoHayNadaSonando: "No hay nada sonando para guardar en favoritos.",
  favGuardadaEnTusFavoritos: (title: string | number): string =>
    `Guardada en tus favoritos: ${title}`,
  favsTodaviaNoTenesFavoritos:
    "Todavía no tenés favoritos. Guardá la canción actual con !fav.",
  unfavNoExisteEseFavorito: "No existe ese favorito. Mirá tu lista con !favs.",
  unfavQuitadaDeTusFavoritos: (title: string | number): string =>
    `Quitada de tus favoritos: ${title}`,
  fuenteTuFuentePreferidaEs: (current: string | number): string =>
    `Tu fuente preferida es: ${current}. Cambiala con !fuente [youtube|soundcloud|auto].`,
  fuenteFuentePreferidaTusBusquedas: (source: string | number): string =>
    `Fuente preferida: ${source}. Tus búsquedas con !play y !yt van ahí.`,
  topsTodaviaNoHayReproducciones: "Todavía no hay reproducciones registradas.",
  myStatsTodaviaNoTenesReproducciones:
    "Todavía no tenés reproducciones ni favoritos.",
  autoplayAutoplayActivadoCuandoSe:
    "Autoplay activado: cuando se vacíe la cola sigo con temas parecidos.",
  autoplayAutoplayDesactivadoPrendeloCon:
    "Autoplay desactivado. Prendelo con !autoplay on.",
  autoplayAutoplayActivadoCuandoSe2:
    "Autoplay activado: cuando se vacíe la cola sigo con temas parecidos.",
  autoplayAutoplayDesactivado: "Autoplay desactivado.",
  radioSintonizando: (input: string | number): string =>
    `Sintonizando: ${input}.`,
  radioSintonizandoKbps: (
    name: string | number,
    value2: string | number,
  ): string => `Sintonizando: ${name}${value2}.`,
  radioNoEncontreEmisorasPara: (input: string | number): string =>
    `No encontré emisoras para "${input}". Probá con otro nombre, género o link de TuneIn.`,
  radioSintonizandoKbps2: (
    name: string | number,
    value2: string | number,
  ): string => `Sintonizando: ${name}${value2}.`,
  favPlayNoExisteEseFavorito:
    "No existe ese favorito. Mirá tu lista con !favs.",
  favPlayAgregadaALaCola: (title: string | number): string =>
    `Agregada a la cola: ${title}`,
  moveMovidaALaPosicion: (
    to: string | number,
    title: string | number,
  ): string => `Movida a la posición ${to}: ${title}`,
  moveLaPistaYaEsta: "La pista ya está en esa posición.",
  moveNoExisteAlgunaDe: "No existe alguna de esas posiciones en la cola.",
  removeSoloElAdministradorDel:
    "Solo el administrador del bot puede quitar rangos con pistas de otros usuarios.",
  removeNoExisteEsaPosicion: "No existe esa posición en la cola.",
  removeQuitadaDeLaCola: (title: string | number): string =>
    `Quitada de la cola: ${title}`,
  removeSeQuitaronPistasDe: (length: string | number): string =>
    `Se quitaron ${length} pistas de la cola.`,
  clearLaColaTienePistas:
    "La cola tiene pistas de otros usuarios: solo un admin puede vaciarla. Usá !remove para quitar las tuyas.",
  clearLaColaYaEstaba: "La cola ya estaba vacía.",
  clearSeQuitaronPistasDe: (cleared: string | number): string =>
    `Se quitaron ${cleared} pistas de la cola.`,
  channelMoveNoEncontreNingunCanal: (input: string | number): string =>
    `No encontré ningún canal con "${input}".`,
  channelMoveEncontreVariosCanalesSe: (list: string | number): string =>
    `Encontré varios canales: ${list}. Sé más específico.`,
  channelMoveNoTenesPermisosPara:
    "No tenés permisos para mover el bot de canal.",
  channelMoveEseCanalRequiereRango:
    "Ese canal requiere rango Admin o superior.",
  channelMoveEseCanalRequiereRango2:
    "Ese canal requiere rango Senior Admin o superior.",
  channelMoveMovidoAlCanal: (value1: string | number): string =>
    `Movido al canal: ${value1}`,
  channelMoveNoPudeMovermeA: "No pude moverme a ese canal (¿permisos?).",
  shuffleNoHayPistasEn: "No hay pistas en la cola para mezclar.",
  shuffleColaMezcladaPistas: (shuffled: string | number): string =>
    `Cola mezclada (${shuffled} pistas).`,
  nowPlayingNoHayNadaReproduciendose: "No hay nada reproduciéndose.",
  nowPlayingReproduciendoPor: (
    value1: string | number,
    value2: string | number,
    requestedBy: string | number,
  ): string => `Reproduciendo: ${value1} (${value2} - por ${requestedBy})`,
  skipSoloQuienPidioLa:
    "Solo quien pidió la canción (o un admin) puede saltarla.",
  skipPistaSaltada: "Pista saltada.",
  skipVotoSoloOyentes: "Para votar tenés que estar en el canal del bot.",
  skipVotoRegistrado: (votes: number, needed: number): string =>
    `Voto para saltar registrado (${votes}/${needed}).`,
  skipVotacionAprobada: (votes: number, needed: number): string =>
    `Votación aprobada (${votes}/${needed}): pista saltada.`,
  jumpNoExisteEsaPosicion: "No existe esa posición en la cola.",
  jumpSoloQuienPidioLas:
    "Solo quien pidió las pistas (o un admin) puede saltar hasta ahí.",
  jumpSaltandoALaPosicion: (
    index: string | number,
    title: string | number,
  ): string => `Saltando a la posición ${index}: ${title}.`,
  statsText: (
    statsOutput: string | number,
    authLine: string | number,
  ): string => `${statsOutput}${authLine}`,
  diagSoloLosAdministradoresPueden:
    "Solo los administradores pueden usar este comando.",
  debugServerSoloLosAdministradoresPueden:
    "Solo los administradores pueden usar este comando.",
  chartSoloLosAdministradoresPueden:
    "Solo los administradores pueden usar este comando.",
  chartTodaviaNoHayDatos: "Todavía no hay datos de telemetría de usuarios.",
  stopHayPistasDeOtros:
    "Hay pistas de otros usuarios en reproducción o en cola: solo un admin puede detener todo.",
  stopReproduccionDetenida: "Reproducción detenida.",
  testToneNoPuedoReproducirEl:
    "No puedo reproducir el tono mientras hay música. Probá con !stop o esperá a que termine la pista.",
  testToneElTonoEstaraDisponible: (value1: string | number): string =>
    `El tono estará disponible en ${value1} s.`,
  testToneReproduciendoTonoDePrueba: "Reproduciendo tono de prueba (3 s)...",
  testToneTonoDePruebaTerminado: "Tono de prueba terminado.",
  loopModoLoopDesactivado: "Modo loop desactivado.",
  loopModoLoopPistaActual: "Modo loop: pista actual en repetición.",
  loopModoLoopColaEn: "Modo loop: cola en repetición.",
  loopModoLoopActualUsa: (loopMode: string | number): string =>
    `Modo loop actual: ${loopMode}. Usá !loop [off|track|queue].`,
  volumeVolumenAjustadoA: (volume: string | number): string =>
    `Volumen ajustado a ${volume}%.`,
  lyricsNoHayNadaReproduciendose: "No hay nada reproduciéndose.",
  lyricsBuscandoLaLetra: "Buscando la letra...",
  lyricsNoEncontreLaLetra: (title: string | number): string =>
    `No encontré la letra de: ${title}`,
  lyricsN: (title: string | number, body: string | number): string =>
    `${title}\n${body}`,
  playlistPlaylistGuardadaPistas: (
    nameArg: string | number,
    count: string | number,
  ): string => `Playlist "${nameArg}" guardada (${count} pistas).`,
  playlistCargandoPistas: (
    nameArg: string | number,
    count: string | number,
  ): string => `Cargando "${nameArg}" (${count} pistas).`,
  playlistNoTenesPlaylistsGuardadas: "No tenés playlists guardadas.",
  playlistLaListaTienePagina: (
    pages: string | number,
    pages2: string | number,
  ): string =>
    `La lista tiene ${pages} página(s). Usá !playlist list ${pages2}.`,
  playlistNoEncontreLaPlaylist: (nameArg: string | number): string =>
    `No encontré la playlist "${nameArg}".`,
  playlistLaPlaylistEstaVacia: (nameArg: string | number): string =>
    `La playlist "${nameArg}" está vacía.`,
  playlistLaPlaylistTienePagina: (
    pages: string | number,
    nameArg: string | number,
    pages2: string | number,
  ): string =>
    `La playlist tiene ${pages} página(s). Usá !playlist show ${nameArg} ${pages2}.`,
  playlistPlaylistEliminada: (nameArg: string | number): string =>
    `Playlist "${nameArg}" eliminada.`,
  playlistNoEncontreLaPlaylist2: (nameArg: string | number): string =>
    `No encontré la playlist "${nameArg}".`,
  playlistNoEncontrePistasEn: "No encontré pistas en esa URL.",
  playlistAgregandoPistasDeLa: (
    length: string | number,
    nameArg: string | number,
  ): string => `Agregando ${length} pistas de la playlist a "${nameArg}"...`,
  playlistAgregandoPistaSA: (
    length: string | number,
    nameArg: string | number,
  ): string => `Agregando ${length} pista(s) a "${nameArg}"...`,
  playlistPlaylistCreadaAgregandoPistas: (
    nameArg: string | number,
    length: string | number,
  ): string => `Playlist "${nameArg}" creada. Agregando ${length} pistas...`,
  playlistNoEncontreLaPlaylist3: (nameArg: string | number): string =>
    `No encontré la playlist "${nameArg}".`,
  playlistIndiceInvalidoLaPlaylist: (
    nameArg: string | number,
    total: string | number,
  ): string =>
    `Índice inválido. La playlist "${nameArg}" tiene ${total} pistas.`,
  playlistTrackEliminadoDeTiene: (
    nameArg: string | number,
    total: string | number,
  ): string => `Track eliminado de "${nameArg}". Tiene ${total} pistas.`,
  playlistNoEncontreLaPlaylist4: (oldName: string | number): string =>
    `No encontré la playlist "${oldName}".`,
  playlistYaExisteUnaPlaylist: (name: string | number): string =>
    `Ya existe una playlist llamada "${name}".`,
  playlistPlaylistRenombradaA: (
    oldName: string | number,
    newName: string | number,
  ): string => `Playlist "${oldName}" renombrada a "${newName}".`,
  playlistNoEncontreLaPlaylist5: (nameArg: string | number): string =>
    `No encontré la playlist "${nameArg}".`,
  playlistPlaylistPistasDuracionTotal: (
    name: string | number,
    trackCount: string | number,
    value3: string | number,
    value4: string | number,
  ): string =>
    `Playlist "${name}": ${trackCount} pistas, duración total ~${value3}. Creada el ${value4}.`,
  playlistUsaPlaylistSaveLoad:
    "Usá: !playlist save|load|list|show|delete|add|remove|rename|info <nombre>",
  // Usage and validation errors from the chat parser
  parseChatCommandNoReconozcoEseComando:
    "No reconozco ese comando. Escribí !help para ver los disponibles.",
  parseChatCommandUsaChannelMoveNombre:
    "Usá: !channel-move <nombre o id del canal>",
  parseChatCommandUsaPlayLinkO: "Usá: !play <link o término de búsqueda>",
  parseChatCommandUsaYtNBusqueda: "Usá: !yt <n> <búsqueda>",
  parseChatCommandUsaYtTerminoDe: "Usá: !yt <término de búsqueda>",
  parseChatCommandUsaPlaynextLinkO:
    "Usá: !playnext <link o término de búsqueda>",
  parseChatCommandUsageLoopOffTrack: "Usá: !loop [off|track|queue]",
  parseChatCommandUsaSeekSegundos: "Usá: !seek <segundos>",
  parseChatCommandUsaFuenteYoutubeSoundcloud:
    "Usá: !fuente [youtube|soundcloud|auto]",
  parseChatCommandUsaRadioNombreGenero: "Usá: !radio <nombre, género o link>",
  parseChatCommandUsaAutoplayOnOff: "Usá: !autoplay [on|off]",
  parseChatCommandUsaPlaylistNombre: (action: string | number): string =>
    `Usá: !playlist ${action} <nombre>`,
  parseChatCommandUsaPlaylistAddNombre: "Usá: !playlist add <nombre> <url>",
  parseChatCommandUsaPlaylistRemoveNombre:
    "Usá: !playlist remove <nombre> <índice>",
  parseChatCommandUsaPlaylistRenameViejo:
    "Usá: !playlist rename <viejo> <nuevo>",
  parseChatCommandUsaPlaylistSaveLoad:
    "Usá: !playlist save|load|list|show|delete|add|remove|rename|info <nombre>",
  parseChatCommandUsaHelp14:
    "Usá: !help [1-4 | reproducción | cola | administración | otros | comando]",
  parseChatCommandElComandoNoAcepta: (rawName: string | number): string =>
    `El comando !${rawName} no acepta argumentos`,
  parsePositionUsa: (usage: string | number): string => `Usá: ${usage}`,
  parsePositionLaPosicionTieneQue: "La posición tiene que ser mayor a 0.",
  parseRangeUsaPosicionDesdeHasta: (command: string | number): string =>
    `Usá: !${command} <posición|desde-hasta>`,
  parseRangeElRangoTieneQue: "El rango tiene que ser ascendente (ej: 2-5).",
  parseMoveUsaMoveDesdeHasta: "Usá: !move <desde> <hasta>",
  parseVolumeUsaVolume0100: "Usá: !volume <0-100>",
  parseVolumeElVolumenTieneQue: "El volumen tiene que estar entre 0 y 100.",
  // Playback service errors shown to users
  enqueueLosArchivosLocalesNo:
    "Los archivos locales no están soportados: pegá un link de YouTube o SoundCloud, o buscá con !yt.",
  enqueueSpotifyNoEstaConfigurado:
    "Spotify no está configurado en este bot: pegá un link de YouTube o SoundCloud, o buscá con !yt.",
  enqueueLasPlaylistsYAlbumes:
    "Las playlists y álbumes de Spotify se expanden con !play desde el canal.",
  enqueueNoEncontreLosDatos: "No encontré los datos del track de Spotify.",
  enqueueNoReconozcoEseLink:
    "No reconozco ese link: pegá un link de YouTube o SoundCloud, una URL de audio directa (mp3, ogg, m3u8…), o buscá con !yt.",
  enqueueNoPudeEncontrarEse:
    "No pude encontrar ese set de SoundCloud en YouTube o SoundCloud.",
  enqueueLasPlaylistsDeApple:
    "Las playlists de Apple Music se expanden con !play desde el canal.",
  enqueueEsteBotNoTiene:
    "Este bot no tiene resolución de links de Apple Music configurada.",
  enqueueNoEncontreLosDatos2: "No encontré los datos del track de Apple Music.",
  enqueueNoPudeEncontrarEsa:
    "No pude encontrar esa canción en YouTube o SoundCloud.",
  enqueueSoloSeSoportanVideos:
    "Solo se soportan videos de YouTube, links de SoundCloud y playlists de YouTube por ahora.",
  enqueueSoundcloudSearchNoEncontreEsaBusqueda:
    "No encontré esa búsqueda en SoundCloud. Probá con !yt para buscar en YouTube.",
  enqueueSearchIndexNoHayResultadoPara: (index: string | number): string =>
    `No hay resultado ${index} para esa búsqueda.`,
  enqueueNextLasPlaylistsSeEncolan:
    "Las playlists se encolan con !play, no con !playnext.",
  savePlaylistLaColaEstaVacia:
    "La cola está vacía: no hay nada para guardar en la playlist.",
  loadPlaylistNoEncontreLaPlaylist: (rawName: string | number): string =>
    `No encontré la playlist "${rawName}".`,
  loadPlaylistLaPlaylistEstaVacia: (rawName: string | number): string =>
    `La playlist "${rawName}" está vacía.`,
  resolvePlaylistTracksSoloSeSoportanUrls:
    "Solo se soportan URLs de YouTube (video o playlist) para agregar.",
  requirePlaylistStoreLasPlaylistsNoEstan:
    "Las playlists no están configuradas en este bot.",
  enqueuePlaylistSoloSePuedenExpandir:
    "Solo se pueden expandir playlists de YouTube con !play.",
  enqueueMusicLinkEsteBotNoTiene:
    "Este bot no tiene resolución de links de Apple Music o Amazon Music configurada.",
  enqueueMusicLinkNoPudeEncontrarEse:
    "No pude encontrar ese link en YouTube o SoundCloud. Probá pegando el link directo de YouTube.",
  enqueueMusicLinkElLinkSoloExiste:
    "El link solo existe en SoundCloud, pero ese proveedor no está configurado.",
  enqueueMusicLinkElLinkAlternativoNo:
    "El link alternativo no apunta a una fuente reproducible.",
  withExpansionSlotYaHayUnaPlaylist:
    "Ya hay una playlist o álbum expandiéndose; esperá un momento.",
  enqueueSpotifyCollectionSpotifyNoEstaConfigurado:
    "Spotify no está configurado en este bot: pegá un link de YouTube o SoundCloud, o buscá con !yt.",
  enqueueSpotifyCollectionSoloSePuedenExpandir:
    "Solo se pueden expandir colecciones de Spotify con !play.",
  enqueueAppleMusicCollectionEsteBotNoTiene:
    "Este bot no tiene resolución de links de Apple Music configurada.",
  // Playback driver errors shown to users
  jumpToUsaJumpPosicion: "Usá: !jump <posición>",
  jumpToNoExisteEsaPosicion: "No existe esa posición en la cola.",
  seekNoHayNadaReproduciendose:
    "No hay nada reproduciéndose para saltar de posición.",
  replayPreviousNoHayNingunaCancion:
    "No hay ninguna canción anterior para repetir.",
} as const;

export type Messages = typeof messages;
