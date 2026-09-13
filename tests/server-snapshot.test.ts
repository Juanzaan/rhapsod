import { describe, expect, it } from "vitest";

import {
  ChannelDirectory,
  ServerSnapshot,
} from "../src/application/server-snapshot.js";

describe("ServerSnapshot", () => {
  it("starts empty at version zero", () => {
    const snapshot = new ServerSnapshot();
    expect(snapshot.version).toBe(0);
    expect(snapshot.toJSON()).toEqual({
      version: 0,
      channels: [],
      clients: [],
    });
  });

  it("seeds from a full resync", () => {
    const snapshot = new ServerSnapshot();
    snapshot.fullResync(
      [
        { cid: 2, name: "Music", parentCid: 1 },
        { cid: 1, name: "Lobby" },
      ],
      [{ clid: 5, name: "Ana", cid: 2 }],
    );
    const view = snapshot.toJSON();
    expect(view.version).toBe(1);
    expect(view.channels.map((c) => c.cid)).toEqual([1, 2]);
    expect(view.channels[1]).toMatchObject({ cid: 2, parentCid: 1 });
    expect(view.clients).toEqual([{ clid: 5, name: "Ana", cid: 2 }]);
  });

  it("ignores invalid ids on resync", () => {
    const snapshot = new ServerSnapshot();
    snapshot.fullResync(
      [
        { cid: 0, name: "zero" },
        { cid: -3, name: "neg" },
        { cid: 7, name: "ok" },
      ],
      [
        { clid: -1, name: "neg", cid: 7 },
        { clid: 9, name: "ok", cid: 7 },
      ],
    );
    const view = snapshot.toJSON();
    expect(view.channels.map((c) => c.cid)).toEqual([7]);
    expect(view.clients.map((c) => c.clid)).toEqual([9]);
  });

  it("patches enter, move and leave incrementally", () => {
    const snapshot = new ServerSnapshot();
    snapshot.fullResync([{ cid: 1, name: "Lobby" }], []);
    snapshot.applyEnter({ clid: 5, name: "Ana", cid: 1 });
    expect(snapshot.toJSON().clients).toHaveLength(1);
    snapshot.applyMove(5, 2);
    expect(snapshot.toJSON().clients[0]).toMatchObject({ clid: 5, cid: 2 });
    snapshot.applyLeave(5);
    expect(snapshot.toJSON().clients).toEqual([]);
    expect(snapshot.version).toBe(4);
  });

  it("ignores moves and leaves of unknown clients", () => {
    const snapshot = new ServerSnapshot();
    snapshot.fullResync([], []);
    snapshot.applyMove(99, 2);
    snapshot.applyLeave(99);
    expect(snapshot.version).toBe(1);
    expect(snapshot.toJSON().clients).toEqual([]);
  });

  it("replaces channels without touching clients", () => {
    const snapshot = new ServerSnapshot();
    snapshot.fullResync(
      [{ cid: 1, name: "A" }],
      [{ clid: 5, name: "Ana", cid: 1 }],
    );
    snapshot.setChannels([{ cid: 2, name: "B", parentCid: 1 }]);
    const view = snapshot.toJSON();
    expect(view.channels).toEqual([{ cid: 2, name: "B", parentCid: 1 }]);
    expect(view.clients).toHaveLength(1);
  });

  it("replaces state on resync", () => {
    const snapshot = new ServerSnapshot();
    snapshot.fullResync(
      [{ cid: 1, name: "A" }],
      [{ clid: 5, name: "Ana", cid: 1 }],
    );
    snapshot.fullResync([{ cid: 2, name: "B" }], []);
    const view = snapshot.toJSON();
    expect(view.channels.map((c) => c.cid)).toEqual([2]);
    expect(view.clients).toEqual([]);
  });
});

describe("ChannelDirectory", () => {
  it("resolves and caches channel info", async () => {
    let calls = 0;
    const directory = new ChannelDirectory((cid: number) => {
      calls++;
      return Promise.resolve({ name: `Ch${cid}`, parentCid: 1 });
    });
    expect(await directory.resolve(2)).toEqual({
      cid: 2,
      name: "Ch2",
      parentCid: 1,
    });
    expect(await directory.resolve(2)).toEqual({
      cid: 2,
      name: "Ch2",
      parentCid: 1,
    });
    expect(calls).toBe(1);
    expect(directory.snapshot()).toEqual([
      { cid: 2, name: "Ch2", parentCid: 1 },
    ]);
  });

  it("falls back to #cid when info is missing or fails", async () => {
    const missing = new ChannelDirectory(() => Promise.resolve(undefined));
    expect(await missing.resolve(9)).toEqual({ cid: 9, name: "#9" });
    const failing = new ChannelDirectory(() =>
      Promise.reject(new Error("nope")),
    );
    expect(await failing.resolve(10)).toEqual({ cid: 10, name: "#10" });
  });

  it("does not cache failed resolutions", async () => {
    let fail = true;
    const directory = new ChannelDirectory(() =>
      fail
        ? Promise.reject(new Error("blip"))
        : Promise.resolve({ name: "Lobby" }),
    );
    expect(await directory.resolve(1)).toEqual({ cid: 1, name: "#1" });
    fail = false;
    expect(await directory.resolve(1)).toEqual({ cid: 1, name: "Lobby" });
  });

  it("omits parentCid when unknown", async () => {
    const directory = new ChannelDirectory(() =>
      Promise.resolve({ name: "Solo" }),
    );
    expect(await directory.resolve(3)).toEqual({ cid: 3, name: "Solo" });
  });

  it("discovers empty channels the client list never mentions", async () => {
    // Voice clients cannot run `channellist`; the full tree comes from
    // probing `channelinfo` per cid, which also answers for empty channels.
    const existing = new Map([
      [1, { name: "Lobby" }],
      [3, { name: "Empty room", parentCid: 1, order: 0 }],
    ]);
    const directory = new ChannelDirectory((cid: number) =>
      Promise.resolve(existing.get(cid)),
    );
    const result = await directory.discover({ ceiling: 4, concurrency: 2 });
    expect(result).toEqual({ ceiling: 4, found: 2 });
    expect(directory.snapshot()).toEqual([
      { cid: 1, name: "Lobby" },
      { cid: 3, name: "Empty room", order: 0, parentCid: 1 },
    ]);
    expect(directory.maxCid()).toBe(3);
  });

  it("ignores nameless rows instead of caching phantom channels", async () => {
    // A swallowed `channelinfo` error surfaces as an empty row; without a
    // name the cid does not exist and must not enter the tree as `#cid`.
    const directory = new ChannelDirectory((cid: number) =>
      cid === 1 ? Promise.resolve({ name: "Lobby" }) : Promise.resolve({}),
    );
    const result = await directory.discover({ ceiling: 3, concurrency: 2 });
    expect(result.found).toBe(1);
    expect(directory.snapshot()).toEqual([{ cid: 1, name: "Lobby" }]);
  });

  it("evicts deleted channels but keeps entries above the ceiling", async () => {
    const directory = new ChannelDirectory(() => Promise.resolve(undefined));
    directory.prime({ cid: 2, name: "Gone" });
    directory.prime({ cid: 9, name: "Above ceiling" });
    const result = await directory.discover({ ceiling: 4, concurrency: 2 });
    expect(result.found).toBe(0);
    // A scan that finds nothing is a failed scan: keep the cache.
    expect(directory.snapshot()).toEqual([
      { cid: 2, name: "Gone" },
      { cid: 9, name: "Above ceiling" },
    ]);
  });

  it("evicts only the probed range on a successful scan", async () => {
    const directory = new ChannelDirectory((cid: number) =>
      cid === 1
        ? Promise.resolve({ name: "Lobby" })
        : Promise.resolve(undefined),
    );
    directory.prime({ cid: 2, name: "Deleted" });
    directory.prime({ cid: 50, name: "Above ceiling" });
    const result = await directory.discover({ ceiling: 4, concurrency: 2 });
    expect(result.found).toBe(1);
    expect(directory.snapshot()).toEqual([
      { cid: 1, name: "Lobby" },
      { cid: 50, name: "Above ceiling" },
    ]);
  });

  it("tolerates fetch failures and bounds concurrency", async () => {
    let inFlight = 0;
    let peak = 0;
    const directory = new ChannelDirectory((cid: number) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          inFlight--;
          if (cid % 2 === 0) reject(new Error("gone"));
          else resolve({ name: `Ch${cid}` });
        }, 5);
      });
    });
    const result = await directory.discover({ ceiling: 6, concurrency: 2 });
    expect(result.found).toBe(3);
    expect(peak).toBeLessThanOrEqual(2);
    expect(directory.snapshot().map((c) => c.cid)).toEqual([1, 3, 5]);
  });
});
