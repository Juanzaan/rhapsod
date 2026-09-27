import { createContext, runInContext } from "node:vm";

import { describe, expect, it } from "vitest";

import { panelScript } from "../src/panel/panel-scripts.js";

interface FakeElement {
  value: string;
  innerHTML: string;
  textContent: string;
  className: string;
  disabled: boolean;
  style: Record<string, string>;
  children: unknown[];
  classList: { add: (name: string) => void };
}

function element(value = ""): FakeElement {
  return {
    children: [],
    className: "",
    classList: { add: () => undefined },
    disabled: false,
    innerHTML: "",
    style: {},
    textContent: "",
    value,
  };
}

interface Wizard {
  /** Replaces the fields on screen, like rendering another step. */
  show(fields: Readonly<Record<string, string>>): void;
  run(code: string): unknown;
  requests: { url: string; body?: string }[];
  respond: (url: string, body: unknown) => void;
}

/**
 * Runs src/panel/scripts/setup.js against a minimal DOM. Only the ids a
 * test puts on screen exist, which is what broke collect().
 */
function wizard(): Wizard {
  let onScreen = new Map<string, FakeElement>();
  const fixed = new Map<string, FakeElement>([
    ["w", element()],
    ["tt", element()],
    ["yh", element()],
  ]);
  const responses = new Map<string, unknown>();
  const requests: { url: string; body?: string }[] = [];
  const button = element();
  const context = createContext({
    document: {
      getElementById: (id: string) => onScreen.get(id) ?? fixed.get(id) ?? null,
      querySelector: () => button,
    },
    fetch: (url: string, init?: { body?: string }) => {
      requests.push({ url, ...(init?.body ? { body: init.body } : {}) });
      return Promise.resolve({
        json: () => Promise.resolve(responses.get(url) ?? { ok: true }),
      });
    },
    fx: () => undefined,
    initAmbience: () => undefined,
    setTimeout: () => 0,
    toast: () => undefined,
    window: { location: { href: "" } },
  });
  runInContext(panelScript("setup"), context);
  return {
    requests,
    respond: (url, body) => responses.set(url, body),
    run: (code) => runInContext(code, context) as unknown,
    show: (fields) => {
      onScreen = new Map(
        Object.entries(fields).map(([id, value]) => [id, element(value)]),
      );
    },
  };
}

const flush = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

describe("setup wizard", () => {
  it("keeps values from earlier steps when later steps are on screen", () => {
    const w = wizard();
    w.run("cur = 1");
    w.show({ ih: "ts.example.org", in: "SmokeBot", ip: "9987", iw: "" });
    w.run("next()");
    // Channel step: the TeamSpeak inputs are no longer rendered.
    w.show({ ic: "Music", icid: "", icp: "" });
    w.run("next()");
    w.show({ ibr: "96000", il: "-14", iv: "false" });
    w.run("next()");

    expect(w.run("vals.RHAPSOD_TS3_HOST")).toBe("ts.example.org");
    expect(w.run("vals.RHAPSOD_TS3_NICKNAME")).toBe("SmokeBot");
    expect(w.run("vals.RHAPSOD_TS3_CHANNEL_NAME")).toBe("Music");
    expect(w.run("vals.RHAPSOD_OPUS_BITRATE")).toBe("96000");
  });

  it("points new installs to !claim and keeps admin UIDs as an advanced field", () => {
    const w = wizard();
    const fresh = String(w.run("rO()"));
    expect(fresh).toContain("!claim");
    expect(fresh).toContain("<details>");
    expect(fresh).toContain('id="iua"');

    w.run('vals.RHAPSOD_ADMIN_UIDS = "abc="');
    expect(String(w.run("rO()"))).toContain("<details open>");
  });

  it("moves on after a successful connection test", async () => {
    const w = wizard();
    w.run("cur = 1");
    w.show({ ih: "ts.example.org", in: "Rhapsod", ip: "9987", iw: "" });
    w.respond("/api/test-connection", { ok: true, serverName: "Test" });
    w.run("testTs3()");
    await flush();
    expect(w.run("cur")).toBe(2);
  });

  it("stays on the step and offers to continue when the test fails", async () => {
    const w = wizard();
    w.run("cur = 1");
    w.show({ ih: "ts.example.org", in: "Rhapsod", ip: "9987", iw: "" });
    w.respond("/api/test-connection", { error: "timeout", ok: false });
    w.run("testTs3()");
    await flush();
    expect(w.run("cur")).toBe(1);
    expect(w.run("document.getElementById('tt').innerHTML")).toContain(
      "Continuar sin probar",
    );
  });

  it("saves only settings keys, not the YouTube check result", async () => {
    const w = wizard();
    w.run("cur = 1");
    w.show({ ih: "ts.example.org", in: "Rhapsod", ip: "9987", iw: "" });
    w.run("next()");
    w.respond("/api/youtube-health", { ms: 120, ok: true });
    w.run("checkYt()");
    await flush();
    w.show({});
    w.run("save()");
    await flush();

    const put = w.requests.find((request) => request.url === "/api/env");
    const keys = Object.keys(JSON.parse(put?.body ?? "{}") as object);
    expect(keys.length).toBeGreaterThan(0);
    // /api/env answers 400 "Clave desconocida" for anything else.
    expect(keys.filter((key) => !key.startsWith("RHAPSOD_"))).toEqual([]);
    expect(keys).toContain("RHAPSOD_TS3_AUTO_CONNECT");
  });
});
