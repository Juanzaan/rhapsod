import { describe, expect, it, vi } from "vitest";

import type { Ts3Connection } from "../src/adapters/ts3/ts3-connection.js";
import { ServerViewSync } from "../src/bootstrap/server-view.js";
import { noopLogger } from "../src/observability/logger.js";

const CHANNELS: Readonly<Record<number, Record<string, string>>> = {
  1: { channel_name: "Lobby", channel_order: "0" },
  2: { channel_name: "Music", cpid: "1", channel_order: "1" },
  3: { channel_name: "Empty", channel_order: "2" },
};

function fakeConnection(
  clients: Awaited<ReturnType<Ts3Connection["listClients"]>> = [
    { clid: 7, name: "Ana", uid: "uid-ana", cid: 2, groups: ["6"] },
  ],
) {
  return {
    getChannelInfo: vi.fn((cid: number) =>
      Promise.resolve(CHANNELS[cid] ?? {}),
    ),
    listClients: vi.fn(() => Promise.resolve(clients)),
  };
}

describe("ServerViewSync", () => {
  it("shows occupied channels and clients without uids before any discovery", async () => {
    const connection = fakeConnection();
    const view = new ServerViewSync(connection, noopLogger);
    await view.resync();

    const json = view.toJSON();
    expect(json.channels).toEqual([
      { cid: 2, name: "Music", order: 1, parentCid: 1 },
    ]);
    expect(json.clients).toEqual([{ cid: 2, clid: 7, name: "Ana" }]);
    expect(JSON.stringify(json)).not.toContain("uid-ana");
  });

  it("lists empty channels once a full discovery ran", async () => {
    const view = new ServerViewSync(fakeConnection(), noopLogger);
    await view.resync({ full: true });

    expect(view.mode).toBe("full");
    expect(view.toJSON().channels.map((channel) => channel.name)).toEqual([
      "Lobby",
      "Music",
      "Empty",
    ]);
  });

  it("runs the full discovery only on every tenth minute tick", async () => {
    const connection = fakeConnection();
    const view = new ServerViewSync(connection, noopLogger);
    for (let tick = 1; tick <= 9; tick++) await view.tick();
    // Only the occupied channel was probed so far.
    expect(
      new Set(connection.getChannelInfo.mock.calls.map(([cid]) => cid)),
    ).toEqual(new Set([2]));

    await view.tick();
    expect(connection.getChannelInfo.mock.calls.length).toBeGreaterThan(100);
    expect(view.mode).toBe("full");
  });

  it("adds a channel a client moved into", async () => {
    const view = new ServerViewSync(fakeConnection([]), noopLogger);
    await view.resync();
    await view.ensureChannel(3);
    expect(view.toJSON().channels).toEqual([
      { cid: 3, name: "Empty", order: 2 },
    ]);
  });

  it("keeps the last view when the client list cannot be read", async () => {
    const connection = fakeConnection();
    const view = new ServerViewSync(connection, noopLogger);
    await view.resync();
    const before = view.toJSON();
    connection.listClients.mockRejectedValueOnce(new Error("disconnected"));

    await expect(view.resync()).resolves.toBeUndefined();
    expect(view.toJSON()).toEqual(before);
  });
});
