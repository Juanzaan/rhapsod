import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AdminAlerts,
  formatNoticeList,
  type OnlineClient,
} from "../src/application/notices/admin-alerts.js";
import type { Finding } from "../src/application/notices/notice.js";
import { NoticeRegistry } from "../src/application/notices/notice-registry.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const talkPower: Finding = {
  detector: "ts3.no-talk-power",
  severity: "error",
  titleEs: "El bot no puede hablar en su canal",
  detailEs: "Dar talk power al bot.",
};

const lowDisk: Finding = {
  detector: "disk.data-low",
  severity: "warning",
  titleEs: "Queda poco espacio en disco",
  detailEs: "Liberar espacio.",
};

const alerts: AdminAlerts[] = [];
const dirs: string[] = [];

afterEach(() => {
  for (const created of alerts.splice(0)) created.stop();
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
});

function harness(options: { online?: OnlineClient[]; start?: number } = {}) {
  let now = options.start ?? 1_000_000;
  const clock = () => now;
  const registry = new NoticeRegistry({ now: clock });
  const online: OnlineClient[] = options.online ?? [
    { clid: 7, uid: "admin" },
    { clid: 8, uid: "listener" },
  ];
  const sent: { clid: number; text: string }[] = [];
  const created = new AdminAlerts({
    registry,
    adminUids: () => new Set(["admin"]),
    listClients: () => Promise.resolve(online),
    sendPrivateMessage: (clid, text) => {
      sent.push({ clid, text });
      return Promise.resolve();
    },
    now: clock,
    coalesceMs: 60 * 60_000,
  });
  alerts.push(created);
  return {
    alerts: created,
    online,
    registry,
    sent,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("AdminAlerts", () => {
  it("sends error notices privately to online admins only", async () => {
    const { alerts: admin, registry, sent } = harness();
    admin.start();
    registry.report(talkPower);
    registry.report(lowDisk);
    await admin.deliver();
    expect(sent).toEqual([
      {
        clid: 7,
        text: "Avisos de Rhapsod:\n[Error] El bot no puede hablar en su canal. Dar talk power al bot.\nLista completa: !avisos",
      },
    ]);
  });

  it("coalesces notices that open together into one message", async () => {
    const { alerts: admin, registry, sent } = harness();
    admin.start();
    registry.report(talkPower);
    registry.report({
      detector: "panel.bind-exposed",
      severity: "critical",
      titleEs: "El panel está expuesto",
      detailEs: "Volver a 127.0.0.1.",
    });
    await admin.deliver();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain("[Crítico] El panel está expuesto");
  });

  it("reports the resolution only of what an admin was told", async () => {
    const { alerts: admin, registry, sent } = harness();
    admin.start();
    registry.report(talkPower);
    registry.ok("ts3.no-talk-power");
    await admin.deliver();
    expect(sent).toEqual([]);

    registry.report(talkPower);
    await admin.deliver();
    registry.ok("ts3.no-talk-power");
    await admin.deliver();
    expect(sent.map((message) => message.text.split("\n")[1])).toEqual([
      "[Error] El bot no puede hablar en su canal. Dar talk power al bot.",
      "[Resuelto] El bot no puede hablar en su canal.",
    ]);
  });

  it("does not page the same notice again within six hours", async () => {
    const { advance, alerts: admin, registry, sent } = harness();
    admin.start();
    registry.report(talkPower);
    await admin.deliver();
    registry.ok("ts3.no-talk-power");
    await admin.deliver();
    advance(HOUR);
    registry.report(talkPower);
    await admin.deliver();
    expect(sent).toHaveLength(2);
    registry.ok("ts3.no-talk-power");
    advance(6 * HOUR);
    registry.report(talkPower);
    await admin.deliver();
    expect(sent).toHaveLength(3);
  });

  it("pages an escalation even inside the resend window", async () => {
    const { alerts: admin, registry, sent } = harness();
    admin.start();
    const reconnect = (severity: Finding["severity"]): Finding => ({
      detector: "ts3.reconnecting",
      severity,
      titleEs: "Se perdió la conexión con TeamSpeak",
      detailEs: "Reconectando.",
    });
    registry.report(reconnect("warning"));
    await admin.deliver();
    expect(sent).toEqual([]);
    registry.report(reconnect("error"));
    await admin.deliver();
    expect(sent).toHaveLength(1);
  });

  it("caps messages at five an hour and keeps the rest queued", async () => {
    const { advance, alerts: admin, registry, sent } = harness();
    admin.start();
    for (let i = 0; i < 6; i++) {
      registry.report({ ...talkPower, subject: String(i) });
      await admin.deliver();
    }
    expect(sent).toHaveLength(5);
    advance(HOUR);
    await admin.deliver();
    expect(sent).toHaveLength(6);
  });

  it("waits for an admin to come online", async () => {
    const {
      alerts: admin,
      online,
      registry,
      sent,
    } = harness({
      online: [{ clid: 8, uid: "listener" }],
    });
    admin.start();
    registry.report(talkPower);
    await admin.deliver();
    expect(sent).toEqual([]);
    online.push({ clid: 9, uid: "admin" });
    admin.adminEntered("listener");
    admin.adminEntered("admin");
    await admin.deliver();
    expect(sent.map((message) => message.clid)).toEqual([9]);
  });

  it("drops a queued line whose notice resolved or was ignored", async () => {
    const { alerts: admin, registry, sent } = harness({ online: [] });
    admin.start();
    registry.report(talkPower);
    await admin.deliver();
    registry.ignore("ts3.no-talk-power");
    admin.adminEntered("admin");
    await admin.deliver();
    expect(sent).toEqual([]);
  });

  it("at start, sends only recent error notices left by the last process", async () => {
    const { advance, alerts: admin, registry, sent } = harness();
    registry.report({
      ...talkPower,
      detector: "process.event-loop-stall",
      titleEs: "El bot se trabó y se reinició",
    });
    registry.report(lowDisk);
    advance(5 * MINUTE);
    admin.start();
    await admin.deliver();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain("El bot se trabó y se reinició");

    const later = harness();
    later.registry.report(talkPower);
    later.advance(20 * MINUTE);
    later.alerts.start();
    await later.alerts.deliver();
    expect(later.sent).toEqual([]);
  });
});

describe("AdminAlerts across restarts and failures", () => {
  const stall: Finding = {
    ...talkPower,
    detector: "process.event-loop-stall",
    titleEs: "El bot se trabó y se reinició",
  };

  function boot(filePath: string, now: () => number) {
    const registry = new NoticeRegistry({ filePath, now });
    const sent: string[] = [];
    const admin = new AdminAlerts({
      registry,
      adminUids: () => new Set(["admin"]),
      listClients: () => Promise.resolve([{ clid: 7, uid: "admin" }]),
      sendPrivateMessage: (_clid, text) => {
        sent.push(text);
        return Promise.resolve();
      },
      now,
      coalesceMs: HOUR,
    });
    alerts.push(admin);
    return { registry, admin, sent };
  }

  it("does not page the same notice on every start of a crash loop", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rhapsod-alerts-"));
    dirs.push(dir);
    const filePath = join(dir, "notices.json");
    let now = 1_000_000;
    const clock = () => now;
    let total = 0;
    for (let start = 0; start < 6; start++) {
      const { registry, admin, sent } = boot(filePath, clock);
      registry.report(stall);
      admin.start();
      await admin.deliver();
      await registry.flush();
      admin.stop();
      total += sent.length;
      now += 40_000;
    }
    expect(total).toBe(1);
  });

  it("drops a queued resolution when the notice opens again", async () => {
    const { advance, alerts: admin, online, registry, sent } = harness();
    admin.start();
    registry.report(talkPower);
    await admin.deliver();
    online.splice(0);
    registry.ok("ts3.no-talk-power");
    await admin.deliver();
    advance(HOUR);
    registry.report(talkPower);
    online.push({ clid: 7, uid: "admin" });
    admin.adminEntered("admin");
    await admin.deliver();
    expect(sent.map((message) => message.text)).not.toContain(
      expect.stringContaining("[Resuelto]"),
    );
    expect(sent).toHaveLength(1);
  });

  it("retries on its own after the client list fails", async () => {
    vi.useFakeTimers();
    const registry = new NoticeRegistry();
    let failures = 1;
    const sent: string[] = [];
    const admin = new AdminAlerts({
      registry,
      adminUids: () => new Set(["admin"]),
      listClients: () =>
        failures-- > 0
          ? Promise.reject(new Error("reconnecting"))
          : Promise.resolve([{ clid: 7, uid: "admin" }]),
      sendPrivateMessage: (_clid, text) => {
        sent.push(text);
        return Promise.resolve();
      },
    });
    alerts.push(admin);
    admin.start();
    registry.report(talkPower);
    await admin.deliver();
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(sent).toHaveLength(1);
  });

  it("sends what the hourly cap held back once the hour passes", async () => {
    vi.useFakeTimers();
    const registry = new NoticeRegistry();
    const sent: string[] = [];
    const admin = new AdminAlerts({
      registry,
      adminUids: () => new Set(["admin"]),
      listClients: () => Promise.resolve([{ clid: 7, uid: "admin" }]),
      sendPrivateMessage: (_clid, text) => {
        sent.push(text);
        return Promise.resolve();
      },
    });
    alerts.push(admin);
    admin.start();
    for (let i = 0; i < 6; i++) {
      registry.report({ ...talkPower, subject: String(i) });
      await admin.deliver();
    }
    expect(sent).toHaveLength(5);
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(sent).toHaveLength(6);
  });
});

describe("formatNoticeList", () => {
  it("numbers notices and marks the ignored ones", () => {
    const registry = new NoticeRegistry();
    registry.report(talkPower);
    registry.report(lowDisk);
    registry.ignore("disk.data-low");
    expect(formatNoticeList(registry.list())).toBe(
      [
        "Avisos abiertos (2):",
        "1. [Error] El bot no puede hablar en su canal. Dar talk power al bot.",
        "2. [Atención] (ignorado) Queda poco espacio en disco. Liberar espacio.",
        "Para ocultar uno hasta que empeore: !avisos ignorar <n>",
      ].join("\n"),
    );
    expect(formatNoticeList([])).toBe("No hay avisos abiertos.");
  });
});
