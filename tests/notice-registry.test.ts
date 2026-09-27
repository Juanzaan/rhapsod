import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { Finding } from "../src/application/notices/notice.js";
import {
  NoticeRegistry,
  parseStoredFile,
  type NoticeTransition,
} from "../src/application/notices/notice-registry.js";

const MINUTE = 60_000;

function clock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const potDown: Finding = {
  detector: "pot.provider-down",
  severity: "warning",
  titleEs: "El proveedor de PO tokens no responde",
  detailEs: "detalle",
};

const talkPower: Finding = {
  detector: "ts3.no-talk-power",
  severity: "error",
  titleEs: "El bot no puede hablar en su canal",
  detailEs: "detalle",
};

function tempFile(): string {
  return join(mkdtempSync(join(tmpdir(), "rhapsod-notices-")), "notices.json");
}

describe("NoticeRegistry", () => {
  it("keeps a polled finding pending until it repeats inside the window", () => {
    const time = clock();
    const registry = new NoticeRegistry({ now: time.now });
    registry.report(potDown);
    time.advance(MINUTE);
    registry.report(potDown);
    expect(registry.list()).toEqual([]);
    expect(registry.get("pot.provider-down")?.state).toBe("pending");
    time.advance(MINUTE);
    registry.report(potDown);
    expect(registry.list()).toMatchObject([
      { key: "pot.provider-down", state: "open", occurrences: 3 },
    ]);
  });

  it("does not open when the repeats are spread past the window", () => {
    const time = clock();
    const registry = new NoticeRegistry({ now: time.now });
    for (let i = 0; i < 3; i++) {
      registry.report(potDown);
      time.advance(4 * MINUTE);
    }
    expect(registry.list()).toEqual([]);
  });

  it("drops a pending finding on the first OK", () => {
    const registry = new NoticeRegistry();
    registry.report(potDown);
    registry.ok("pot.provider-down");
    expect(registry.get("pot.provider-down")).toBeUndefined();
  });

  it("needs clearAfter consecutive OKs, and a new finding resets the count", () => {
    const registry = new NoticeRegistry();
    const daemon: Finding = {
      detector: "ytdlp.daemon-fallback",
      severity: "warning",
      titleEs: "daemon",
      detailEs: "detalle",
    };
    registry.report(daemon);
    registry.ok("ytdlp.daemon-fallback");
    registry.ok("ytdlp.daemon-fallback");
    registry.report(daemon);
    registry.ok("ytdlp.daemon-fallback");
    registry.ok("ytdlp.daemon-fallback");
    expect(registry.list()).toHaveLength(1);
    registry.ok("ytdlp.daemon-fallback");
    expect(registry.list()).toEqual([]);
  });

  it("emits opened, escalated and resolved once each", () => {
    const registry = new NoticeRegistry();
    const seen: NoticeTransition["kind"][] = [];
    registry.onTransition((transition) => seen.push(transition.kind));
    const reconnect = (severity: Finding["severity"]): Finding => ({
      detector: "ts3.reconnecting",
      severity,
      titleEs: "reconectando",
      detailEs: "detalle",
    });
    registry.report(reconnect("warning"));
    registry.report(reconnect("warning"));
    registry.report(reconnect("error"));
    registry.report(reconnect("warning"));
    registry.ok("ts3.reconnecting");
    expect(seen).toEqual(["opened", "escalated", "resolved"]);
  });

  it("sorts worst first and derives the health verdict", () => {
    const registry = new NoticeRegistry();
    expect(registry.verdict()).toBe("ok");
    registry.report({ ...potDown, detector: "disk.data-low" });
    expect(registry.verdict()).toBe("ok");
    registry.report(talkPower);
    expect(registry.verdict()).toBe("degraded");
    registry.report({
      detector: "panel.bind-exposed",
      severity: "critical",
      titleEs: "panel",
      detailEs: "detalle",
    });
    expect(registry.verdict()).toBe("unhealthy");
    expect(registry.list().map((notice) => notice.severity)).toEqual([
      "critical",
      "error",
      "warning",
    ]);
  });

  it("keeps a flapping notice open until the detector is quiet for 30 min", () => {
    const time = clock();
    const registry = new NoticeRegistry({ now: time.now });
    for (let i = 0; i < 4; i++) {
      registry.report(talkPower);
      time.advance(MINUTE);
      registry.ok("ts3.no-talk-power");
      time.advance(MINUTE);
    }
    const notice = registry.get("ts3.no-talk-power");
    expect(notice).toMatchObject({ state: "open", flapping: true });
    time.advance(20 * MINUTE);
    registry.sweep();
    expect(registry.get("ts3.no-talk-power")?.state).toBe("open");
    time.advance(10 * MINUTE);
    registry.sweep();
    expect(registry.get("ts3.no-talk-power")).toBeUndefined();
  });

  it("expires notices that nothing reported for their policy's time", () => {
    const time = clock();
    const registry = new NoticeRegistry({ now: time.now });
    registry.report({
      detector: "process.restart-loop",
      severity: "critical",
      titleEs: "loop",
      detailEs: "detalle",
    });
    time.advance(59 * MINUTE);
    registry.sweep();
    expect(registry.list()).toHaveLength(1);
    time.advance(MINUTE);
    registry.sweep();
    expect(registry.list()).toEqual([]);
  });

  it("ignores a notice until its severity rises", () => {
    const registry = new NoticeRegistry();
    registry.report(potDown);
    registry.report(potDown);
    registry.report(potDown);
    expect(registry.ignore("pot.provider-down")).toBe(true);
    expect(registry.get("pot.provider-down")?.state).toBe("ignored");
    registry.report(potDown);
    expect(registry.get("pot.provider-down")?.state).toBe("ignored");
    registry.report({ ...potDown, severity: "error" });
    expect(registry.get("pot.provider-down")?.state).toBe("open");
    expect(registry.ignore("missing")).toBe(false);
  });

  it("does not count ignored notices in the verdict", () => {
    const registry = new NoticeRegistry();
    registry.report(talkPower);
    registry.ignore("ts3.no-talk-power");
    expect(registry.verdict()).toBe("ok");
  });

  it("persists only persistent notices, ignores and starts across a reload", async () => {
    const filePath = tempFile();
    const time = clock();
    const registry = new NoticeRegistry({ filePath, now: time.now });
    registry.report({
      detector: "process.event-loop-stall",
      severity: "error",
      titleEs: "trabado",
      detailEs: "detalle",
      data: { driftMs: 45_000 },
    });
    registry.report({
      detector: "ts3.reconnecting",
      subject: "gave-up",
      severity: "critical",
      titleEs: "reinicio",
      detailEs: "detalle",
      persistent: true,
    });
    registry.report(talkPower);
    registry.ignore("ts3.no-talk-power");
    registry.recordStart();
    await registry.flush();

    const reloaded = new NoticeRegistry({ filePath, now: time.now });
    expect(reloaded.list().map((notice) => notice.key)).toEqual([
      "ts3.reconnecting:gave-up",
      "process.event-loop-stall",
    ]);
    expect(reloaded.get("process.event-loop-stall")?.data).toEqual({
      driftMs: 45_000,
    });
    reloaded.report(talkPower);
    expect(reloaded.get("ts3.no-talk-power")?.state).toBe("ignored");
    expect(reloaded.recordStart()).toHaveLength(2);
  });

  it("forgets starts older than an hour", () => {
    const time = clock();
    const registry = new NoticeRegistry({ now: time.now });
    registry.recordStart();
    time.advance(61 * MINUTE);
    expect(registry.recordStart()).toEqual([time.now()]);
  });

  it("sets a corrupt file aside and starts empty", () => {
    const filePath = tempFile();
    writeFileSync(filePath, "{ not json");
    const registry = new NoticeRegistry({ filePath });
    expect(registry.list()).toEqual([]);
    const dir = join(filePath, "..");
    expect(
      readdirSync(dir).some((name) => name.startsWith("notices.json.corrupt-")),
    ).toBe(true);
  });

  it("writes no file when nothing persistent changed", async () => {
    const filePath = tempFile();
    const registry = new NoticeRegistry({ filePath });
    registry.report(talkPower);
    await registry.flush();
    expect(() => readFileSync(filePath)).toThrow();
  });
});

describe("parseStoredFile", () => {
  it("drops unknown detectors and malformed entries one by one", () => {
    const parsed = parseStoredFile({
      version: 1,
      notices: [
        {
          key: "process.event-loop-stall",
          detector: "process.event-loop-stall",
          severity: "error",
          titleEs: "t",
          detailEs: "d",
          firstSeen: 1,
          lastSeen: 2,
          occurrences: 1,
          data: { ok: 1, nested: { no: true } },
        },
        { key: "x", detector: "future.detector", severity: "error" },
        "garbage",
      ],
      ignored: [{ key: "a", severity: "loud", at: 1 }],
      starts: [1, "2", 3],
    });
    expect(parsed?.notices).toHaveLength(1);
    expect(parsed?.notices[0]?.data).toEqual({ ok: 1 });
    expect(parsed?.ignored).toEqual([]);
    expect(parsed?.starts).toEqual([1, 3]);
  });

  it("rejects other versions", () => {
    expect(parseStoredFile({ version: 2 })).toBeUndefined();
    expect(parseStoredFile([])).toBeUndefined();
  });
});
