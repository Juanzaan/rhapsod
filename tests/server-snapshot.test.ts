import { describe, expect, it } from "vitest";

import { ServerSnapshot } from "../src/application/server-snapshot.js";

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
