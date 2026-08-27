import { describe, expect, it, vi, type Mock } from "vitest";

import { parseChatCommand } from "../src/commands/chat-command.js";
import {
  dispatchCommand,
  type CommandContext,
  type CommandSender,
} from "../src/commands/command-handlers.js";

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
    pause: vi.fn(),
    resume: vi.fn(),
    skip: vi.fn(),
    stop: vi.fn(),
    replayPrevious: vi.fn(() => ({
      id: "x",
      requestedBy: "user",
      source: "s",
      title: "Track",
    })),
    seek: vi.fn(),
    queue: vi.fn(() => []),
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
      ["playlist", "!playlist"],
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
    expect(send).toHaveBeenCalledWith('Playlist "fiesta" guardada (15 pistas).');
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
    expect(playback.deletePlaylist).toHaveBeenCalledWith("fiesta", "uid-1", false);
    expect(send).toHaveBeenCalledWith('Playlist "fiesta" eliminada.');
  });

  it("lets admins delete any playlist", async () => {
    const { ctx, playback, send, sender } = makeHarness({
      adminUids: new Set(["uid-1"]),
    });
    (playback.deletePlaylist as Mock).mockReturnValueOnce(true);
    const command = parseChatCommand("!playlist delete fiesta")!;
    await dispatchCommand(ctx, command, sender, send);
    expect(playback.deletePlaylist).toHaveBeenCalledWith("fiesta", "uid-1", true);
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
    expect(send).toHaveBeenCalledWith('Playlist "fiesta" actualizada. Tiene 2 pistas.');
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
    expect(send).toHaveBeenCalledWith('Playlist "fiesta" creada. Agregando 1 pistas...');
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
    expect(send).toHaveBeenCalledWith('Track eliminado de "fiesta". Tiene 2 pistas.');
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
    expect(send).toHaveBeenCalledWith('Playlist "fiesta" renombrada a "partido".');
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
