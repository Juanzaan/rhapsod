import { describe, expect, it, vi, type Mock } from "vitest";

import { parseChatCommand } from "../src/commands/chat-command.js";
import {
  dispatchCommand,
  type CommandContext,
  type CommandSender,
} from "../src/commands/command-handlers.js";
import { searchStations } from "../src/media/radio-directory.js";

vi.mock("../src/media/radio-directory.js", () => ({
  searchStations: vi.fn((): Promise<unknown[]> => Promise.resolve([])),
}));

function makeHarness(
  overrides: {
    adminUids?: ReadonlySet<string>;
    current?: unknown;
    hasStartedPlaying?: boolean;
  } = {},
) {
  const playback = {
    enqueue: vi.fn(() => ({
      id: "x",
      requestedBy: "user",
      source: "s",
      title: "Track",
    })),
    enqueuePlaylist: vi.fn(() => ({ added: [] })),
    enqueueSpotifyCollection: vi.fn(() => ({ added: [] })),
    enqueueMusicLink: vi.fn(() => ({ added: [] })),
    enqueueNext: vi.fn(() => ({
      id: "x",
      requestedBy: "user",
      source: "s",
      title: "Track",
    })),
    enqueueSearch: vi.fn(() => ({
      id: "x",
      requestedBy: "user",
      source: "s",
      title: "Track",
    })),
    enqueueSearchIndex: vi.fn(() => ({
      id: "x",
      requestedBy: "user",
      source: "s",
      title: "Track",
    })),
    enqueueSoundcloudSearch: vi.fn(() => ({
      id: "soundcloud:1",
      requestedBy: "user",
      source: "https://soundcloud.com/artist/track",
      title: "Artist - Track",
    })),
    pause: vi.fn(),
    resume: vi.fn(),
    skip: vi.fn(),
    jumpTo: vi.fn(),
    autoplayEnabled: false,
    setAutoplay: vi.fn(),
    stop: vi.fn(),
    replayPrevious: vi.fn(() => ({
      id: "x",
      requestedBy: "user",
      source: "s",
      title: "Track",
    })),
    seek: vi.fn(),
    queue: vi.fn(
      (): Array<{
        durationSeconds?: number;
        requestedBy: string;
        requestedByUid?: string;
        title: string;
      }> => [],
    ),
    history: vi.fn(() => []),
    moveQueued: vi.fn(),
    removeQueuedRange: vi.fn(() => []),
    clearQueued: vi.fn(() => 0),
    shuffleQueued: vi.fn(() => 0),
    setLoopMode: vi.fn(),
    setVolume: vi.fn(),
    setFilter: vi.fn(() => undefined),
    getLyrics: vi.fn(() => undefined),
    savePlaylist: vi.fn(() => 0),
    loadPlaylist: vi.fn(() => 0),
    listPlaylists: vi.fn(() => []),
    showPlaylist: vi.fn(() => undefined),
    deletePlaylist: vi.fn(() => false),
    resolvePlaylistTracks: vi.fn(() =>
      Promise.resolve({ source: "video", tracks: [] }),
    ),
    addPlaylistTracks: vi.fn(() => ({
      added: 0,
      created: true,
      skipped: 0,
      total: 0,
      truncated: false,
    })),
    removePlaylistTrack: vi.fn(() => ({ status: "removed", total: 0 })),
    renamePlaylist: vi.fn(() => ({ status: "renamed" })),
    getPlaylistInfo: vi.fn(() => undefined),
    audioHealth: undefined,
    current: overrides.current,
    playbackPositionMs: 0,
    filter: "off",
    loopMode: "off",
    tracksPlayed: 0,
    volume: 50,
  };
  const connection = {
    sendChannelMessage: vi.fn(() => undefined),
    listChannels: vi.fn(() => []),
    listClients: vi.fn(() => []),
    getServerInfo: vi.fn(() => ({})),
    getChannelInfo: vi.fn(() => ({ channel_name: "X" })),
    moveToChannel: vi.fn(() => undefined),
  };
  const metrics = {
    formatStats: vi.fn(() => "stats"),
    formatDiag: vi.fn(() => "diag"),
  };
  const telemetry = {
    recordBotMovedBy: vi.fn(),
    snapshot: vi.fn(() => []),
  };
  const radioTitles = {
    get: vi.fn((): Promise<string | undefined> => Promise.resolve(undefined)),
    peek: vi.fn((): string | undefined => undefined),
  };
  const listeningHistory = {
    topArtists: vi.fn((): unknown[] => []),
    topTracks: vi.fn((): unknown[] => []),
    userSummary: vi.fn(
      (): {
        completes: number;
        plays: number;
        skips: number;
        topArtist?: string;
      } => ({ completes: 0, plays: 0, skips: 0 }),
    ),
  };
  const preferences = {
    addFavorite: vi.fn((_uid: unknown, track: Record<string, unknown>) => ({
      addedAt: 0,
      ...track,
    })),
    listFavorites: vi.fn((): unknown[] => []),
    removeFavorite: vi.fn((): unknown => undefined),
    getPreferredSource: vi.fn((): string => "auto"),
    setPreferredSource: vi.fn((_uid: unknown, source: string) => source),
    flush: vi.fn(() => Promise.resolve()),
  };
  const ytDlpExecutor = {
    metrics: vi.fn(() => ({ active: 0, queued: 0, totalRuns: 0 })),
  };
  const commandRateLimiter = {
    acquire: vi.fn(() => ({ allowed: true, retryAfterMs: 0 })),
  };
  const config = { RHAPSOD_TS3_NICKNAME: "Bot" };
  const ctx = {
    playback,
    connection,
    config,
    metrics,
    telemetry,
    preferences,
    radioTitles,
    listeningHistory,
    ytDlpExecutor,
    commandRateLimiter,
    encoder: {},
    adminUids: overrides.adminUids ?? new Set(),
    moveGroupIds: new Set(),
    adminGroupIds: new Set(),
    seniorGroupIds: new Set(),
    adminChannelIds: new Set(),
    seniorChannelIds: new Set(),
    verbose: false,
    hasStartedPlaying: overrides.hasStartedPlaying ?? false,
  } as unknown as CommandContext;
  const sender: CommandSender = { name: "user", uid: "uid-1", groups: [] };
  const send = vi.fn(() => Promise.resolve());
  return {
    ctx,
    playback,
    connection,
    metrics,
    telemetry,
    preferences,
    radioTitles,
    listeningHistory,
    send,
    sender,
    commandRateLimiter,
  };
}

describe("dispatchCommand", () => {
  it("routes every command without throwing and sends exactly once per dispatch", async () => {
    const cases: Array<[string, string]> = [
      ["play", "!play duki rockstar"],
      ["playnext", "!playnext duki rockstar"],
      ["search", "!yt duki rockstar"],
      ["pause", "!pause"],
      ["previous", "!previous"],
      ["resume", "!resume"],
      ["seek", "!seek 30"],
      ["queue", "!queue"],
      ["history", "!history"],
      ["move", "!move 1 2"],
      ["remove", "!remove 1"],
      ["clear", "!clear"],
      ["channel-move", "!channel-move 123"],
      ["shuffle", "!shuffle"],
      ["now-playing", "!now-playing"],
      ["skip", "!skip"],
      ["jump", "!jump 2"],
      ["jump-alias", "!j 2"],
      ["autoplay", "!autoplay"],
      ["autoplay-on", "!autoplay on"],
      ["autoplay-off", "!autoplay off"],
      ["stats", "!stats"],
      ["diag", "!diag"],
      ["debug-server", "!debug-server"],
      ["chart", "!chart"],
      ["stop", "!stop"],
      ["test-tone", "!test-tone"],
      ["help", "!help"],
      ["loop", "!loop off"],
      ["volume", "!volume 50"],
      ["lyrics", "!lyrics"],
      ["bassboost", "!bassboost 2"],
      ["nightcore", "!nightcore 1.2"],
      ["vaporwave", "!vaporwave 0.9"],
      ["8d", "!8d"],
      ["filter", "!filter"],
      ["effects", "!effects"],
      ["playlist", "!playlist"],
      ["fav", "!fav"],
      ["favs", "!favs"],
      ["unfav", "!unfav 1"],
      ["favplay", "!favplay 1"],
      ["favplay-alias", "!fp 1"],
      ["fuente", "!fuente"],
      ["fuente-set", "!fuente soundcloud"],
      ["radio", "!radio jazz"],
      ["radio-alias", "!rb jazz"],
      ["tops", "!tops"],
      ["tops-alias", "!top 3"],
      ["mystats", "!mystats"],
    ];
    const { ctx, send, sender } = makeHarness({ current: { title: "X" } });
    for (const [name, input] of cases) {
      send.mockClear();
      const command = parseChatCommand(input);
      expect(command, `${input} should parse`).toBeDefined();
      await expect(
        dispatchCommand(ctx, command!, sender, send),
      ).resolves.toBeUndefined();
      expect(send, `${name} should send a response`).toHaveBeenCalled();
    }
  });

  it("routes a command to exactly one handler (no double execution)", async () => {
    const { ctx, playback, send, sender } = makeHarness();
    const command = parseChatCommand("!pause")!;
    await dispatchCommand(ctx, command, sender, send);
    expect(playback.pause).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("Reproducción pausada.");
  });

  it("routes aliases through the parser to the right handler", async () => {
    const { ctx, metrics, send, sender } = makeHarness();
    const command = parseChatCommand("!st")!;
    expect(command.name).toBe("stats");
    await dispatchCommand(ctx, command, sender, send);
    expect(metrics.formatStats).toHaveBeenCalledTimes(1);
  });

  it("sets hasStartedPlaying to false on stop", async () => {
    const { ctx, send, sender } = makeHarness({ hasStartedPlaying: true });
    const command = parseChatCommand("!stop")!;
    await dispatchCommand(ctx, command, sender, send);
    expect(ctx.hasStartedPlaying).toBe(false);
  });

  it("enqueues a free-text play through playback.enqueue", async () => {
    const { ctx, playback, send, sender } = makeHarness();
    const command = parseChatCommand("!play duki rockstar")!;
    await dispatchCommand(ctx, command, sender, send);
    expect(playback.enqueue).toHaveBeenCalledWith(
      "duki rockstar",
      "user",
      "uid-1",
    );
    expect(send).toHaveBeenCalledWith("En cola: Track (búsqueda)");
  });

  it("denies admin-only commands to non-admin senders", async () => {
    const { ctx, metrics, send, sender } = makeHarness();
    const diag = parseChatCommand("!diag")!;
    await dispatchCommand(ctx, diag, sender, send);
    expect(metrics.formatDiag).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      "Solo los administradores pueden usar este comando.",
    );
  });

  it("allows admin-only commands for admin senders", async () => {
    const { ctx, metrics, send, sender } = makeHarness({
      adminUids: new Set(["uid-1"]),
    });
    const diag = parseChatCommand("!diag")!;
    await dispatchCommand(ctx, diag, sender, send);
    expect(metrics.formatDiag).toHaveBeenCalledTimes(1);
  });

  it("skips running the test tone while music is playing", async () => {
    const { ctx, playback, commandRateLimiter, send, sender } = makeHarness({
      current: { title: "X" },
    });
    const tone = parseChatCommand("!test-tone")!;
    await dispatchCommand(ctx, tone, sender, send);
    expect(commandRateLimiter.acquire).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      "No puedo reproducir el tono mientras hay música. Probá con !stop o esperá a que termine la pista.",
    );
    expect(playback.skip).not.toHaveBeenCalled();
  });

  it("applies bassboost through setFilter with the parsed level", async () => {
    const { ctx, playback, send, sender } = makeHarness();
    const command = parseChatCommand("!bassboost 3")!;
    await dispatchCommand(ctx, command, sender, send);
    expect(playback.setFilter).toHaveBeenCalledWith("bassboost", { level: 3 });
    expect(send).toHaveBeenCalledWith("Filtro bassboost nivel 3 activado.");
  });

  it("reports the current filter from !filter", async () => {
    const { ctx, playback, send, sender } = makeHarness();
    (playback as { filter: string }).filter = "nightcore";
    const command = parseChatCommand("!filter")!;
    await dispatchCommand(ctx, command, sender, send);
    expect(send).toHaveBeenCalledWith("Filtro actual: nightcore");
  });

  it("disables the filter with !filter off", async () => {
    const { ctx, playback, send, sender } = makeHarness();
    const command = parseChatCommand("!filter off")!;
    await dispatchCommand(ctx, command, sender, send);
    expect(playback.setFilter).toHaveBeenCalledWith("off");
    expect(send).toHaveBeenCalledWith("Filtro desactivado.");
  });

  it("shows playlist help when !playlist has no arguments", async () => {
    const { ctx, send, sender } = makeHarness();
    const command = parseChatCommand("!playlist")!;
    await dispatchCommand(ctx, command, sender, send);
    expect(send).toHaveBeenCalledWith(
      "Usá: !playlist save|load|list|show|delete|add|remove|rename|info <nombre>",
    );
  });

  it("saves the queue with !playlist save", async () => {
    const { ctx, playback, send, sender } = makeHarness();
    (playback.savePlaylist as Mock).mockReturnValueOnce(15);
    const command = parseChatCommand("!playlist save fiesta")!;
    await dispatchCommand(ctx, command, sender, send);
    expect(playback.savePlaylist).toHaveBeenCalledWith("fiesta", "uid-1");
    expect(send).toHaveBeenCalledWith(
      'Playlist "fiesta" guardada (15 pistas).',
    );
  });

  it("loads a playlist with !playlist load", async () => {
    const { ctx, playback, send, sender } = makeHarness();
    (playback.loadPlaylist as Mock).mockReturnValueOnce(10);
    const command = parseChatCommand("!pl load fiesta")!;
    await dispatchCommand(ctx, command, sender, send);
    expect(playback.loadPlaylist).toHaveBeenCalledWith(
      "fiesta",
      "user",
      "uid-1",
    );
    expect(send).toHaveBeenCalledWith('Cargando "fiesta" (10 pistas).');
  });

  it("reports an empty playlist list", async () => {
    const { ctx, send, sender } = makeHarness();
    const command = parseChatCommand("!playlist list")!;
    await dispatchCommand(ctx, command, sender, send);
    expect(send).toHaveBeenCalledWith("No tenés playlists guardadas.");
  });

  it("paginates !playlist list", async () => {
    const { ctx, playback, send, sender } = makeHarness();
    (playback.listPlaylists as Mock).mockReturnValueOnce(
      Array.from({ length: 12 }, (_, i) => ({
        createdAt: i,
        name: `pl${i}`,
        trackCount: i + 1,
      })),
    );
    const command = parseChatCommand("!playlist list 2")!;
    await dispatchCommand(ctx, command, sender, send);
    expect(send).toHaveBeenCalledWith(expect.stringContaining("página 2/2"));
    expect(send).toHaveBeenCalledWith(expect.stringContaining("11. pl10"));
    expect(send).toHaveBeenCalledWith(expect.stringContaining("12. pl11"));
  });

  it("shows a playlist with !playlist show", async () => {
    const { ctx, playback, send, sender } = makeHarness();
    (playback.showPlaylist as Mock).mockReturnValueOnce({
      createdAt: 1,
      name: "fiesta",
      tracks: [{ id: "a", source: "u", title: "Track a" }],
    });
    const command = parseChatCommand("!playlist show fiesta")!;
    await dispatchCommand(ctx, command, sender, send);
    expect(send).toHaveBeenCalledWith(
      'Playlist "fiesta" (página 1/1):\n1. Track a',
    );
  });

  it("reports a missing playlist on !playlist show", async () => {
    const { ctx, send, sender } = makeHarness();
    const command = parseChatCommand("!playlist show nada")!;
    await dispatchCommand(ctx, command, sender, send);
    expect(send).toHaveBeenCalledWith('No encontré la playlist "nada".');
  });

  it("deletes a playlist as its owner", async () => {
    const { ctx, playback, send, sender } = makeHarness();
    (playback.deletePlaylist as Mock).mockReturnValueOnce(true);
    const command = parseChatCommand("!playlist delete fiesta")!;
    await dispatchCommand(ctx, command, sender, send);
    expect(playback.deletePlaylist).toHaveBeenCalledWith(
      "fiesta",
      "uid-1",
      false,
    );
    expect(send).toHaveBeenCalledWith('Playlist "fiesta" eliminada.');
  });

  it("lets admins delete any playlist", async () => {
    const { ctx, playback, send, sender } = makeHarness({
      adminUids: new Set(["uid-1"]),
    });
    (playback.deletePlaylist as Mock).mockReturnValueOnce(true);
    const command = parseChatCommand("!playlist delete fiesta")!;
    await dispatchCommand(ctx, command, sender, send);
    expect(playback.deletePlaylist).toHaveBeenCalledWith(
      "fiesta",
      "uid-1",
      true,
    );
  });

  it("adds tracks to an existing playlist with !playlist add", async () => {
    const { ctx, playback, send, sender } = makeHarness();
    (playback.showPlaylist as Mock).mockReturnValueOnce({
      createdAt: 1,
      name: "fiesta",
      tracks: [],
    });
    (playback.resolvePlaylistTracks as Mock).mockResolvedValueOnce({
      source: "playlist",
      tracks: [
        { id: "a", source: "u", title: "A" },
        { id: "b", source: "u", title: "B" },
      ],
    });
    (playback.addPlaylistTracks as Mock).mockReturnValueOnce({
      added: 2,
      created: false,
      skipped: 0,
      total: 2,
      truncated: false,
    });
    const command = parseChatCommand(
      "!playlist add fiesta https://www.youtube.com/playlist?list=PL1",
    )!;
    await dispatchCommand(ctx, command, sender, send);
    expect(send).toHaveBeenCalledWith(
      'Agregando 2 pistas de la playlist a "fiesta"...',
    );
    expect(send).toHaveBeenCalledWith(
      'Playlist "fiesta" actualizada. Tiene 2 pistas.',
    );
    expect(playback.addPlaylistTracks).toHaveBeenCalledWith(
      "fiesta",
      [
        { id: "a", source: "u", title: "A" },
        { id: "b", source: "u", title: "B" },
      ],
      "uid-1",
    );
  });

  it("reports duplicates and the limit in !playlist add", async () => {
    const { ctx, playback, send, sender } = makeHarness();
    (playback.showPlaylist as Mock).mockReturnValueOnce(undefined);
    (playback.resolvePlaylistTracks as Mock).mockResolvedValueOnce({
      source: "video",
      tracks: [{ id: "a", source: "u", title: "A" }],
    });
    (playback.addPlaylistTracks as Mock).mockReturnValueOnce({
      added: 0,
      created: true,
      skipped: 1,
      total: 1,
      truncated: false,
    });
    const command = parseChatCommand(
      "!playlist add fiesta https://www.youtube.com/watch?v=a",
    )!;
    await dispatchCommand(ctx, command, sender, send);
    expect(send).toHaveBeenCalledWith(
      'Playlist "fiesta" creada. Agregando 1 pistas...',
    );
    expect(send).toHaveBeenCalledWith(
      'Playlist "fiesta" creada. Tiene 1 pistas (1 duplicada(s) saltada(s)).',
    );
  });

  it("reports an empty URL resolution in !playlist add", async () => {
    const { ctx, playback, send, sender } = makeHarness();
    (playback.resolvePlaylistTracks as Mock).mockResolvedValueOnce({
      source: "playlist",
      tracks: [],
    });
    const command = parseChatCommand(
      "!playlist add fiesta https://www.youtube.com/playlist?list=PL1",
    )!;
    await dispatchCommand(ctx, command, sender, send);
    expect(send).toHaveBeenCalledWith("No encontré pistas en esa URL.");
  });

  it("removes a track with !playlist remove", async () => {
    const { ctx, playback, send, sender } = makeHarness();
    (playback.removePlaylistTrack as Mock).mockReturnValueOnce({
      status: "removed",
      total: 2,
    });
    const command = parseChatCommand("!playlist remove fiesta 1")!;
    await dispatchCommand(ctx, command, sender, send);
    expect(playback.removePlaylistTrack).toHaveBeenCalledWith(
      "fiesta",
      1,
      "uid-1",
      false,
    );
    expect(send).toHaveBeenCalledWith(
      'Track eliminado de "fiesta". Tiene 2 pistas.',
    );
  });

  it("reports an invalid index in !playlist remove", async () => {
    const { ctx, playback, send, sender } = makeHarness();
    (playback.removePlaylistTrack as Mock).mockReturnValueOnce({
      status: "invalid-index",
      total: 1,
    });
    const command = parseChatCommand("!playlist remove fiesta 9")!;
    await dispatchCommand(ctx, command, sender, send);
    expect(send).toHaveBeenCalledWith(
      'Índice inválido. La playlist "fiesta" tiene 1 pistas.',
    );
  });

  it("renames a playlist with !playlist rename", async () => {
    const { ctx, playback, send, sender } = makeHarness();
    (playback.renamePlaylist as Mock).mockReturnValueOnce({
      status: "renamed",
    });
    const command = parseChatCommand("!playlist rename fiesta partido")!;
    await dispatchCommand(ctx, command, sender, send);
    expect(playback.renamePlaylist).toHaveBeenCalledWith(
      "fiesta",
      "partido",
      "uid-1",
      false,
    );
    expect(send).toHaveBeenCalledWith(
      'Playlist "fiesta" renombrada a "partido".',
    );
  });

  it("reports an existing name in !playlist rename", async () => {
    const { ctx, playback, send, sender } = makeHarness();
    (playback.renamePlaylist as Mock).mockReturnValueOnce({
      status: "name-exists",
      name: "partido",
    });
    const command = parseChatCommand("!playlist rename fiesta partido")!;
    await dispatchCommand(ctx, command, sender, send);
    expect(send).toHaveBeenCalledWith(
      'Ya existe una playlist llamada "partido".',
    );
  });

  it("shows playlist info with !playlist info", async () => {
    const { ctx, playback, send, sender } = makeHarness();
    (playback.getPlaylistInfo as Mock).mockReturnValueOnce({
      createdAt: new Date(2024, 0, 15).getTime(),
      name: "fiesta",
      totalDurationSeconds: 5610,
      trackCount: 3,
    });
    const command = parseChatCommand("!playlist info fiesta")!;
    await dispatchCommand(ctx, command, sender, send);
    expect(send).toHaveBeenCalledWith(
      'Playlist "fiesta": 3 pistas, duración total ~1h 34m. Creada el 15/01/2024.',
    );
  });

  it("lists no active effects with !effects list", async () => {
    const { ctx, send, sender } = makeHarness();
    const command = parseChatCommand("!effects list")!;
    await dispatchCommand(ctx, command, sender, send);
    expect(send).toHaveBeenCalledWith("Sin efectos activos.");
  });

  it("lists the active effect with !effects list", async () => {
    const { ctx, playback, send, sender } = makeHarness();
    (playback as { filter: string }).filter = "nightcore";
    const command = parseChatCommand("!effects list")!;
    await dispatchCommand(ctx, command, sender, send);
    expect(send).toHaveBeenCalledWith("Efectos activos: nightcore.");
  });

  it("resets all effects with !effects reset", async () => {
    const { ctx, playback, send, sender } = makeHarness();
    (playback as { filter: string }).filter = "8d";
    const command = parseChatCommand("!effects reset")!;
    await dispatchCommand(ctx, command, sender, send);
    expect(playback.setFilter).toHaveBeenCalledWith("off");
    expect(send).toHaveBeenCalledWith("Todos los efectos fueron desactivados.");
  });

  it("toggles an effect on with !effects 8d", async () => {
    const { ctx, playback, send, sender } = makeHarness();
    const command = parseChatCommand("!effects 8d")!;
    await dispatchCommand(ctx, command, sender, send);
    expect(playback.setFilter).toHaveBeenCalledWith("8d");
    expect(send).toHaveBeenCalledWith("Efecto 8D activado.");
  });

  it("toggles an active effect off with !effects 8d", async () => {
    const { ctx, playback, send, sender } = makeHarness();
    (playback as { filter: string }).filter = "8d";
    const command = parseChatCommand("!effects 8d")!;
    await dispatchCommand(ctx, command, sender, send);
    expect(playback.setFilter).toHaveBeenCalledWith("off");
    expect(send).toHaveBeenCalledWith("Efecto 8D desactivado.");
  });

  it("enables an effect explicitly with on", async () => {
    const { ctx, playback, send, sender } = makeHarness();
    const command = parseChatCommand("!effects nightcore on")!;
    await dispatchCommand(ctx, command, sender, send);
    expect(playback.setFilter).toHaveBeenCalledWith("nightcore");
    expect(send).toHaveBeenCalledWith("Efecto nightcore activado.");
  });

  it("disables an effect explicitly with off", async () => {
    const { ctx, playback, send, sender } = makeHarness();
    const command = parseChatCommand("!effects bassboost off")!;
    await dispatchCommand(ctx, command, sender, send);
    expect(playback.setFilter).toHaveBeenCalledWith("off");
    expect(send).toHaveBeenCalledWith("Efecto bassboost desactivado.");
  });

  it("delegates !effects test-tone to the existing handler", async () => {
    const { ctx, send, sender } = makeHarness({ current: { title: "X" } });
    const command = parseChatCommand("!effects test-tone")!;
    await dispatchCommand(ctx, command, sender, send);
    expect(send).toHaveBeenCalledWith(
      "No puedo reproducir el tono mientras hay música. Probá con !stop o esperá a que termine la pista.",
    );
  });

  it("delegates !effects chart to the existing admin-only handler", async () => {
    const { ctx, send, sender } = makeHarness();
    const command = parseChatCommand("!effects chart")!;
    await dispatchCommand(ctx, command, sender, send);
    expect(send).toHaveBeenCalledWith(
      "Solo los administradores pueden usar este comando.",
    );
  });
});

describe("dispatchCommand error handling", () => {
  it("lets the parser reject unknown commands before dispatch", () => {
    expect(() => parseChatCommand("!definitely-not-a-command")).toThrow(
      /No reconozco ese comando/,
    );
  });

  it("propagates handler errors so the caller can translate them", async () => {
    const { ctx, send, sender } = makeHarness();
    const playback = ctx.playback as unknown as {
      enqueue: ReturnType<typeof vi.fn>;
    };
    playback.enqueue.mockRejectedValueOnce(new Error("boom"));
    const command = parseChatCommand("!play duki rockstar")!;
    await expect(dispatchCommand(ctx, command, sender, send)).rejects.toThrow(
      "boom",
    );
  });
});

describe("favorites and skip ownership", () => {
  it("saves the current track with !fav", async () => {
    const { ctx, preferences, send, sender } = makeHarness({
      current: {
        id: "abc",
        requestedBy: "user",
        requestedByUid: "uid-1",
        source: "https://youtu.be/abc",
        title: "Duki - Rockstar",
      },
    });
    await dispatchCommand(ctx, parseChatCommand("!fav")!, sender, send);

    expect(preferences.addFavorite).toHaveBeenCalledWith("uid-1", {
      id: "abc",
      source: "https://youtu.be/abc",
      title: "Duki - Rockstar",
    });
    expect(preferences.flush).toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      "Guardada en tus favoritos: Duki - Rockstar",
    );
  });

  it("refuses !fav with nothing playing", async () => {
    const { ctx, preferences, send, sender } = makeHarness();
    await dispatchCommand(ctx, parseChatCommand("!fav")!, sender, send);

    expect(preferences.addFavorite).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      "No hay nada sonando para guardar en favoritos.",
    );
  });

  it("lists favorites with !favs", async () => {
    const { ctx, preferences, send, sender } = makeHarness();
    preferences.listFavorites.mockReturnValue([
      { id: "a", source: "s-a", title: "First" },
      { id: "b", source: "s-b", title: "Second" },
    ]);
    await dispatchCommand(ctx, parseChatCommand("!favs")!, sender, send);

    expect(preferences.listFavorites).toHaveBeenCalledWith("uid-1");
    expect(send).toHaveBeenCalledWith("Tus favoritos:\n1. First\n2. Second");
  });

  it("reports an empty favorites list", async () => {
    const { ctx, send, sender } = makeHarness();
    await dispatchCommand(ctx, parseChatCommand("!favs")!, sender, send);

    expect(send).toHaveBeenCalledWith(
      "Todavía no tenés favoritos. Guardá la canción actual con !fav.",
    );
  });

  it("removes a favorite with !unfav", async () => {
    const { ctx, preferences, send, sender } = makeHarness();
    preferences.removeFavorite.mockReturnValue({ id: "a", title: "First" });
    await dispatchCommand(ctx, parseChatCommand("!unfav 1")!, sender, send);

    expect(preferences.removeFavorite).toHaveBeenCalledWith("uid-1", 1);
    expect(send).toHaveBeenCalledWith("Quitada de tus favoritos: First");
  });

  it("reports a missing favorite on !unfav", async () => {
    const { ctx, send, sender } = makeHarness();
    await dispatchCommand(ctx, parseChatCommand("!unfav 9")!, sender, send);

    expect(send).toHaveBeenCalledWith(
      "No existe ese favorito. Mirá tu lista con !favs.",
    );
  });

  it("enqueues a favorite with !favplay", async () => {
    const { ctx, playback, preferences, send, sender } = makeHarness();
    preferences.listFavorites.mockReturnValue([
      { id: "a", source: "https://youtu.be/a", title: "First" },
    ]);
    await dispatchCommand(ctx, parseChatCommand("!favplay 1")!, sender, send);

    expect(playback.enqueue).toHaveBeenCalledWith(
      "https://youtu.be/a",
      "user",
      "uid-1",
    );
    expect(send).toHaveBeenCalledWith("Agregada a la cola: Track");
  });

  it("reports a missing favorite on !favplay", async () => {
    const { ctx, playback, send, sender } = makeHarness();
    await dispatchCommand(ctx, parseChatCommand("!favplay 3")!, sender, send);

    expect(playback.enqueue).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      "No existe ese favorito. Mirá tu lista con !favs.",
    );
  });

  it("lets the requester skip their own track", async () => {
    const { ctx, playback, send, sender } = makeHarness({
      current: { requestedBy: "user", requestedByUid: "uid-1", title: "X" },
    });
    await dispatchCommand(ctx, parseChatCommand("!skip")!, sender, send);

    expect(playback.skip).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("Pista saltada.");
  });

  it("blocks strangers from skipping someone else's track", async () => {
    const { ctx, playback, send, sender } = makeHarness({
      current: { requestedBy: "other", requestedByUid: "uid-9", title: "X" },
    });
    await dispatchCommand(ctx, parseChatCommand("!skip")!, sender, send);

    expect(playback.skip).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      "Solo quien pidió la canción (o un admin) puede saltarla.",
    );
  });

  it("lets admins skip anyone's track", async () => {
    const { ctx, playback, send, sender } = makeHarness({
      adminUids: new Set(["uid-1"]),
      current: { requestedBy: "other", requestedByUid: "uid-9", title: "X" },
    });
    await dispatchCommand(ctx, parseChatCommand("!skip")!, sender, send);

    expect(playback.skip).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("Pista saltada.");
  });

  it("keeps skipping with nothing playing", async () => {
    const { ctx, playback, send, sender } = makeHarness();
    await dispatchCommand(ctx, parseChatCommand("!skip")!, sender, send);

    expect(playback.skip).toHaveBeenCalledTimes(1);
  });
});

describe("now-playing live titles", () => {
  it("shows the on-air title for live streams", async () => {
    const { ctx, radioTitles, send, sender } = makeHarness({
      current: {
        requestedBy: "user",
        source: "https://ice.example/stream",
        title: "Radio: ice.example",
      },
    });
    radioTitles.get.mockResolvedValue("Live Artist - Live Song");
    await dispatchCommand(ctx, parseChatCommand("!np")!, sender, send);

    expect(radioTitles.get).toHaveBeenCalledWith("https://ice.example/stream");
    expect(send).toHaveBeenCalledWith(
      "Reproduciendo: Live Artist - Live Song (duración desconocida - por user)",
    );
  });

  it("falls back to the station title without metadata", async () => {
    const { ctx, radioTitles, send, sender } = makeHarness({
      current: {
        requestedBy: "user",
        source: "https://ice.example/stream",
        title: "Radio: ice.example",
      },
    });
    await dispatchCommand(ctx, parseChatCommand("!np")!, sender, send);

    expect(radioTitles.get).toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      "Reproduciendo: Radio: ice.example (duración desconocida - por user)",
    );
  });

  it("skips the lookup for tracks with a known duration", async () => {
    const { ctx, radioTitles, send, sender } = makeHarness({
      current: {
        durationSeconds: 180,
        requestedBy: "user",
        source: "https://youtu.be/abc",
        title: "Duki - Rockstar",
      },
    });
    await dispatchCommand(ctx, parseChatCommand("!np")!, sender, send);

    expect(radioTitles.get).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      "Reproduciendo: Duki - Rockstar (3:00 - por user)",
    );
  });
});

describe("preferred source routing", () => {
  it("shows the preferred source with !fuente", async () => {
    const { ctx, preferences, send, sender } = makeHarness();
    preferences.getPreferredSource.mockReturnValue("soundcloud");
    await dispatchCommand(ctx, parseChatCommand("!fuente")!, sender, send);

    expect(send).toHaveBeenCalledWith(
      "Tu fuente preferida es: soundcloud. Cambiala con !fuente [youtube|soundcloud|auto].",
    );
  });

  it("sets the preferred source with !fuente <source>", async () => {
    const { ctx, preferences, send, sender } = makeHarness();
    await dispatchCommand(
      ctx,
      parseChatCommand("!fuente soundcloud")!,
      sender,
      send,
    );

    expect(preferences.setPreferredSource).toHaveBeenCalledWith(
      "uid-1",
      "soundcloud",
    );
    expect(preferences.flush).toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      "Fuente preferida: soundcloud. Tus búsquedas con !play y !yt van ahí.",
    );
  });

  it("routes free-text !play to SoundCloud when preferred", async () => {
    const { ctx, playback, preferences, send, sender } = makeHarness();
    preferences.getPreferredSource.mockReturnValue("soundcloud");
    await dispatchCommand(
      ctx,
      parseChatCommand("!play duki rockstar")!,
      sender,
      send,
    );

    expect(playback.enqueueSoundcloudSearch).toHaveBeenCalledWith(
      "duki rockstar",
      "user",
      "uid-1",
    );
    expect(playback.enqueue).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith("En cola (SoundCloud): Artist - Track");
  });

  it("routes !yt to SoundCloud when preferred", async () => {
    const { ctx, playback, preferences, send, sender } = makeHarness();
    preferences.getPreferredSource.mockReturnValue("soundcloud");
    await dispatchCommand(
      ctx,
      parseChatCommand("!yt duki rockstar")!,
      sender,
      send,
    );

    expect(playback.enqueueSoundcloudSearch).toHaveBeenCalledWith(
      "duki rockstar",
      "user",
      "uid-1",
    );
    expect(playback.enqueueSearch).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith("En cola (SoundCloud): Artist - Track");
  });

  it("keeps links on their provider regardless of preference", async () => {
    const { ctx, playback, preferences, send, sender } = makeHarness();
    preferences.getPreferredSource.mockReturnValue("soundcloud");
    await dispatchCommand(
      ctx,
      parseChatCommand("!play https://youtu.be/abc")!,
      sender,
      send,
    );

    expect(playback.enqueueSoundcloudSearch).not.toHaveBeenCalled();
    expect(playback.enqueue).toHaveBeenCalled();
  });
});

describe("autoplay command", () => {
  it("shows the current autoplay state", async () => {
    const { ctx, send, sender } = makeHarness();
    await dispatchCommand(ctx, parseChatCommand("!autoplay")!, sender, send);

    expect(send).toHaveBeenCalledWith(
      "Autoplay desactivado. Prendelo con !autoplay on.",
    );
  });

  it("toggles autoplay", async () => {
    const { ctx, playback, send, sender } = makeHarness();
    await dispatchCommand(ctx, parseChatCommand("!autoplay on")!, sender, send);

    expect(playback.setAutoplay).toHaveBeenCalledWith(true);
    expect(send).toHaveBeenCalledWith(
      "Autoplay activado: cuando se vacíe la cola sigo con temas parecidos.",
    );

    await dispatchCommand(
      ctx,
      parseChatCommand("!autoplay off")!,
      sender,
      send,
    );
    expect(playback.setAutoplay).toHaveBeenCalledWith(false);
    expect(send).toHaveBeenCalledWith("Autoplay desactivado.");
  });

  it("lets anyone skip communal autoplay tracks", async () => {
    const { ctx, playback, send, sender } = makeHarness({
      current: {
        requestedBy: "Autoplay",
        requestedByUid: "autoplay",
        title: "Mix Pick",
      },
    });
    await dispatchCommand(ctx, parseChatCommand("!skip")!, sender, send);

    expect(playback.skip).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("Pista saltada.");
  });
});

describe("jump and queue ETA", () => {
  const queued = [
    { requestedBy: "user", requestedByUid: "uid-1", title: "One" },
    {
      durationSeconds: 180,
      requestedBy: "user",
      requestedByUid: "uid-1",
      title: "Two",
    },
    {
      durationSeconds: 240,
      requestedBy: "other",
      requestedByUid: "uid-9",
      title: "Three",
    },
  ];

  it("jumps to a queue position the sender owns", async () => {
    const { ctx, playback, send, sender } = makeHarness({
      current: { requestedBy: "user", requestedByUid: "uid-1", title: "Now" },
    });
    playback.queue.mockReturnValue(queued.slice(0, 2));
    await dispatchCommand(ctx, parseChatCommand("!jump 2")!, sender, send);

    expect(playback.jumpTo).toHaveBeenCalledWith(2);
    expect(send).toHaveBeenCalledWith("Saltando a la posición 2: Two.");
  });

  it("blocks jumping over other users' tracks", async () => {
    const { ctx, playback, send, sender } = makeHarness({
      current: { requestedBy: "user", requestedByUid: "uid-1", title: "Now" },
    });
    playback.queue.mockReturnValue([
      { requestedBy: "other", requestedByUid: "uid-9", title: "Theirs" },
      { requestedBy: "user", requestedByUid: "uid-1", title: "Mine" },
    ]);
    await dispatchCommand(ctx, parseChatCommand("!jump 2")!, sender, send);

    expect(playback.jumpTo).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      "Solo quien pidió las pistas (o un admin) puede saltar hasta ahí.",
    );
  });

  it("reports missing positions", async () => {
    const { ctx, playback, send, sender } = makeHarness();
    playback.queue.mockReturnValue(queued.slice(0, 1));
    await dispatchCommand(ctx, parseChatCommand("!jump 5")!, sender, send);

    expect(playback.jumpTo).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith("No existe esa posición en la cola.");
  });

  it("appends the remaining time to the queue", async () => {
    const { ctx, send, sender } = makeHarness();
    const playback = ctx.playback as unknown as {
      queue: ReturnType<typeof vi.fn>;
    };
    playback.queue.mockReturnValue(queued);
    await dispatchCommand(ctx, parseChatCommand("!queue")!, sender, send);

    expect(send).toHaveBeenCalledWith(
      "Cola de reproducción (página 1/1):\n" +
        "1. One (duración desconocida - por user)\n" +
        "2. Two (3:00 - por user)\n" +
        "3. Three (4:00 - por other)\n" +
        "Faltan ~7m (1 sin duración conocida).",
    );
  });
});

describe("autoplay command", () => {
  it("shows the current autoplay state", async () => {
    const { ctx, send, sender } = makeHarness();
    await dispatchCommand(ctx, parseChatCommand("!autoplay")!, sender, send);

    expect(send).toHaveBeenCalledWith(
      "Autoplay desactivado. Prendelo con !autoplay on.",
    );
  });

  it("toggles autoplay", async () => {
    const { ctx, playback, send, sender } = makeHarness();
    await dispatchCommand(ctx, parseChatCommand("!autoplay on")!, sender, send);

    expect(playback.setAutoplay).toHaveBeenCalledWith(true);
    expect(send).toHaveBeenCalledWith(
      "Autoplay activado: cuando se vacíe la cola sigo con temas parecidos.",
    );

    await dispatchCommand(
      ctx,
      parseChatCommand("!autoplay off")!,
      sender,
      send,
    );
    expect(playback.setAutoplay).toHaveBeenCalledWith(false);
    expect(send).toHaveBeenCalledWith("Autoplay desactivado.");
  });

  it("lets anyone skip communal autoplay tracks", async () => {
    const { ctx, playback, send, sender } = makeHarness({
      current: {
        requestedBy: "Autoplay",
        requestedByUid: "autoplay",
        title: "Mix Pick",
      },
    });
    await dispatchCommand(ctx, parseChatCommand("!skip")!, sender, send);

    expect(playback.skip).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("Pista saltada.");
  });
});

describe("radio directory", () => {
  it("tunes the top https station", async () => {
    const { ctx, playback, send, sender } = makeHarness();
    vi.mocked(searchStations).mockResolvedValue([
      {
        bitrate: 128,
        name: "Groove Salad",
        url: "https://ice.example/groovesalad",
        votes: 100,
      },
    ]);
    await dispatchCommand(
      ctx,
      parseChatCommand("!radio groove")!,
      sender,
      send,
    );

    expect(playback.enqueue).toHaveBeenCalledWith(
      "https://ice.example/groovesalad",
      "user",
      "uid-1",
    );
    expect(send).toHaveBeenCalledWith("Sintonizando: Groove Salad (128 kbps).");
  });

  it("skips non-https stations", async () => {
    const { ctx, playback, send, sender } = makeHarness();
    vi.mocked(searchStations).mockResolvedValue([
      { name: "Plain", url: "http://ice.example/plain", votes: 999 },
      { name: "Secure", url: "https://ice.example/secure", votes: 1 },
    ]);
    await dispatchCommand(ctx, parseChatCommand("!rb jazz")!, sender, send);

    expect(playback.enqueue).toHaveBeenCalledWith(
      "https://ice.example/secure",
      "user",
      "uid-1",
    );
    expect(send).toHaveBeenCalledWith("Sintonizando: Secure.");
  });

  it("reports unknown stations", async () => {
    const { ctx, playback, send, sender } = makeHarness();
    vi.mocked(searchStations).mockResolvedValue([]);
    await dispatchCommand(ctx, parseChatCommand("!radio zzz")!, sender, send);

    expect(playback.enqueue).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      'No encontré emisoras para "zzz". Probá con otro nombre o género.',
    );
  });
});

describe("listening stats", () => {
  it("shows the global tops", async () => {
    const { ctx, listeningHistory, send, sender } = makeHarness();
    listeningHistory.topTracks.mockReturnValue([
      { plays: 3, title: "Duki - Rockstar" },
      { plays: 1, title: "Beto - Cumbia" },
    ]);
    await dispatchCommand(ctx, parseChatCommand("!tops")!, sender, send);

    expect(listeningHistory.topTracks).toHaveBeenCalledWith(5);
    expect(send).toHaveBeenCalledWith(
      "Top global:\n1. Duki - Rockstar (3 reproducciones)\n2. Beto - Cumbia (1 reproducción)",
    );
  });

  it("caps the tops page", async () => {
    const { ctx, listeningHistory, send, sender } = makeHarness();
    await dispatchCommand(ctx, parseChatCommand("!tops 50")!, sender, send);

    expect(listeningHistory.topTracks).toHaveBeenCalledWith(10);
  });

  it("reports empty tops", async () => {
    const { ctx, send, sender } = makeHarness();
    await dispatchCommand(ctx, parseChatCommand("!tops")!, sender, send);

    expect(send).toHaveBeenCalledWith(
      "Todavía no hay reproducciones registradas.",
    );
  });

  it("shows personal stats", async () => {
    const { ctx, listeningHistory, preferences, send, sender } = makeHarness();
    listeningHistory.userSummary.mockReturnValue({
      completes: 8,
      plays: 10,
      skips: 2,
      topArtist: "Duki",
    });
    preferences.listFavorites.mockReturnValue([
      { id: "a", title: "Fav" },
      { id: "b", title: "Fav 2" },
    ]);
    await dispatchCommand(ctx, parseChatCommand("!mystats")!, sender, send);

    expect(listeningHistory.userSummary).toHaveBeenCalledWith("uid-1");
    expect(send).toHaveBeenCalledWith(
      "Tus números: 10 reproducciones (8 completadas, 2 saltadas).\nArtista top: Duki.\nFavoritos: 2.",
    );
  });

  it("reports empty personal stats", async () => {
    const { ctx, send, sender } = makeHarness();
    await dispatchCommand(ctx, parseChatCommand("!mystats")!, sender, send);

    expect(send).toHaveBeenCalledWith(
      "Todavía no tenés reproducciones ni favoritos.",
    );
  });
});
