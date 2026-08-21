import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { UserTelemetry } from "../src/application/user-telemetry.js";

const noop = () => undefined;
const logger = {
  info: noop,
  warn: noop,
  error: noop,
  debug: noop,
  fatal: noop,
  trace: noop,
  silent: noop,
} as never;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "telemetry-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function filePath(): string {
  return join(dir, "telemetry.json");
}

describe("UserTelemetry", () => {
  it("records presence and aggregates group ids and talk power", () => {
    const t = new UserTelemetry(filePath(), logger);
    t.clientEntered({ clid: 1, uid: "u1", name: "juan", groupIds: ["90437"], talkPower: 76, channelId: 88 });
    t.clientEntered({ clid: 2, uid: "u1", name: "juan2", groupIds: ["90437", "90450"], talkPower: 90, channelId: 105 });
    const snap = t.snapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0]?.serverGroupIds).toEqual(["90437", "90450"]);
    expect(snap[0]?.maxTalkPower).toBe(90);
    expect(snap[0]?.names).toEqual(["juan", "juan2"]);
  });

  it("tracks command, bot move and bot channel entry counters", () => {
    const t = new UserTelemetry(filePath(), logger);
    t.clientEntered({ clid: 1, uid: "u1", name: "juan", groupIds: [], talkPower: 10, channelId: 88 });
    t.recordCommand("u1");
    t.recordCommand("u1");
    t.recordBotMovedBy("u1");
    t.recordBotChannelEntry("u1");
    const entry = t.snapshot()[0]!;
    expect(entry.commandCount).toBe(2);
    expect(entry.botMovedBy).toBe(1);
    expect(entry.botChannelEntries).toBe(1);
  });

  it("ignores leave events for unknown clids", () => {
    const t = new UserTelemetry(filePath(), logger);
    expect(() => t.clientLeft(999)).not.toThrow();
  });

  it("removes clid mapping on leave but keeps the user record", () => {
    const t = new UserTelemetry(filePath(), logger);
    t.clientEntered({ clid: 5, uid: "u1", name: "juan", groupIds: [], talkPower: 10, channelId: 88 });
    t.clientLeft(5);
    expect(t.snapshot()).toHaveLength(1);
  });

  it("persists and reloads", async () => {
    const t = new UserTelemetry(filePath(), logger);
    t.clientEntered({ clid: 1, uid: "u1", name: "juan", groupIds: ["90437"], talkPower: 76, channelId: 88 });
    await t.save();

    const t2 = new UserTelemetry(filePath(), logger);
    t2.load();
    expect(t2.snapshot()).toHaveLength(1);
    expect(t2.snapshot()[0]?.serverGroupIds).toEqual(["90437"]);
  });

  it("survives a corrupt file on load", () => {
    writeFileSync(filePath(), "not json {");
    const t = new UserTelemetry(filePath(), logger);
    expect(() => t.load()).not.toThrow();
    expect(t.snapshot()).toHaveLength(0);
  });

  it("sorts snapshot by max talk power descending", () => {
    const t = new UserTelemetry(filePath(), logger);
    t.clientEntered({ clid: 1, uid: "a", name: "low", groupIds: [], talkPower: 5, channelId: 1 });
    t.clientEntered({ clid: 2, uid: "b", name: "high", groupIds: [], talkPower: 300, channelId: 1 });
    const names = t.snapshot().map((e) => e.names[0]);
    expect(names).toEqual(["high", "low"]);
  });
});
