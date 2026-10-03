import { describe, expect, it, vi } from "vitest";

import type { Logger } from "pino";

import {
  createBotRenamer,
  panelCommandRunner,
  panelStatus,
} from "../src/bootstrap/panel.js";
import type { AppConfig } from "../src/config.js";
import type { CommandContext } from "../src/commands/command-handlers.js";
import type { Track } from "../src/domain/track.js";

describe("createBotRenamer", () => {
  const logger = { info: vi.fn() } as unknown as Logger;

  it("renames on the server, then updates the shared config", async () => {
    const config = { RHAPSOD_TS3_NICKNAME: "Rhapsod" } as AppConfig;
    const setNickname = vi.fn(() => Promise.resolve());
    await createBotRenamer(config, { setNickname }, logger)("DJ");
    expect(setNickname).toHaveBeenCalledWith("DJ");
    expect(config.RHAPSOD_TS3_NICKNAME).toBe("DJ");
  });

  it("leaves the config alone when the server refuses", async () => {
    const config = { RHAPSOD_TS3_NICKNAME: "Rhapsod" } as AppConfig;
    const setNickname = vi.fn(() => Promise.reject(new Error("in use")));
    await expect(
      createBotRenamer(config, { setNickname }, logger)("DJ"),
    ).rejects.toThrow("in use");
    expect(config.RHAPSOD_TS3_NICKNAME).toBe("Rhapsod");
  });
});

describe("panelCommandRunner", () => {
  const context = {
    adminUids: new Set(["uid-owner"]),
  } as unknown as CommandContext;

  it("runs bare commands as the panel admin and joins the replies", async () => {
    const dispatch = vi.fn(
      async (
        ctx: CommandContext,
        _command: unknown,
        _sender: unknown,
        send: (text: string) => Promise<void>,
      ) => {
        expect([...ctx.adminUids].sort()).toEqual(["panel", "uid-owner"]);
        await send("uno");
        await send("dos");
      },
    );
    await expect(panelCommandRunner(context, dispatch)("skip")).resolves.toBe(
      "uno\ndos",
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.anything(),
      { name: "skip" },
      { groups: [], name: "Panel", uid: "panel" },
      expect.any(Function),
    );
    // The shared context keeps its own admin list.
    expect([...context.adminUids]).toEqual(["uid-owner"]);
  });

  it("answers OK when the command sends nothing", async () => {
    const dispatch = vi.fn(() => Promise.resolve());
    await expect(panelCommandRunner(context, dispatch)("!pause")).resolves.toBe(
      "OK",
    );
  });

  it("rejects input that is not a command", async () => {
    await expect(panelCommandRunner(context, vi.fn())("")).rejects.toThrow(
      "Comando no valido",
    );
  });
});

describe("panelStatus", () => {
  function sources(current: Track | undefined, channelId = 5) {
    return {
      connection: { getCurrentChannelId: () => channelId },
      metrics: {
        disconnectSummary: () => ({ count: 0 }),
      },
      playback: {
        autoplayEnabled: true,
        current,
        loopMode: "off",
        playbackPositionMs: 1_500,
        playerState: "playing" as const,
        queue: () => [current as Track],
        tracksPlayed: 3,
        volume: 60,
      },
      radioTitles: { peek: () => "Artist - Now On Air" },
      scrobbler: { confirmedCount: 2 },
      uptimeSeconds: () => 12.3456,
    } as unknown as Parameters<typeof panelStatus>[0];
  }

  it("reports a finite track with its duration", () => {
    const status = panelStatus(
      sources({
        durationSeconds: 200,
        id: "a",
        requestedBy: "Ana",
        source: "https://youtu.be/a",
        title: "Artist - Song",
      }),
    );
    expect(status).toMatchObject({
      autoplay: true,
      connected: true,
      currentChannelId: 5,
      currentTitle: "Artist - Song",
      currentRequester: "Ana",
      durationMs: 200_000,
      queueLength: 1,
      tracksPlayed: 5,
      uptimeMs: 12_346,
    });
  });

  it("shows the song on air for live radio and no duration", () => {
    const status = panelStatus(
      sources({
        id: "r",
        requestedBy: "Ana",
        source: "https://radio.example/stream",
        title: "Radio Example",
      }),
    );
    expect(status.currentTitle).toBe("Artist - Now On Air");
    expect(status).not.toHaveProperty("durationMs");
  });

  it("reports disconnected while reconnecting despite a cached channel id", () => {
    const status = panelStatus({
      ...sources(undefined, 5),
      reconnecting: () => true,
    });
    expect(status.connected).toBe(false);
    expect(status.reconnecting).toBe(true);
  });

  it("includes YouTube login and daemon health when known", () => {
    const status = panelStatus({
      ...sources(undefined),
      youtubeAuthHealthy: () => false,
      ytdlpDaemon: () => ({
        state: "failing",
        consecutiveFailures: 2,
        fallbacksTotal: 5,
      }),
    });
    expect(status).toMatchObject({
      connected: true,
      reconnecting: false,
      youtubeAuthHealthy: false,
      ytdlpDaemon: { state: "failing", fallbacksTotal: 5 },
    });
  });

  it("reports disconnected without a channel id", () => {
    const status = panelStatus(sources(undefined, 0));
    expect(status.connected).toBe(false);
    expect(status).not.toHaveProperty("currentChannelId");
    expect(status).not.toHaveProperty("currentTitle");
  });
});
