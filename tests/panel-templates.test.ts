import { describe, expect, it } from "vitest";

import {
  renderCommandsPage,
  renderDashboard,
  renderSettingsPage,
  renderSetupWizard,
} from "../src/panel/panel-templates.js";
import type { PanelStatus } from "../src/panel/panel-server.js";

function render(status: Partial<PanelStatus> = {}): string {
  return renderDashboard(
    { connected: true, queueLength: 0, version: "2.2.0", ...status },
    "admin",
    "secret",
  );
}

describe("renderDashboard console", () => {
  it("renders program deck controls", () => {
    const html = render({
      currentTitle: "Song",
      durationMs: 200_000,
      playerState: "playing",
      positionMs: 60_000,
    });
    for (const id of [
      "lamp",
      "nsState",
      "nt",
      "tcur",
      "tdur",
      "seek",
      "seekf",
      "ppBtn",
      "vol",
      "volv",
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain("PLAYING");
    expect(html).toContain("1:00");
    expect(html).toContain("3:20");
  });

  it("renders standby state without position", () => {
    const html = render();
    expect(html).toContain("STANDBY");
    expect(html).toContain("--:--");
  });

  it("renders loop, filters, queue actions and drawers", () => {
    const html = render({ queueLength: 2 });
    for (const id of [
      "loopSeg",
      "fxRow",
      "chat",
      "chatIn",
      "chatEmpty",
      "ql",
      "qc",
      "dwCard",
      "dw",
      "nxChk",
      "stTracks",
      "ytRes",
      "ec",
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it("loads GSAP for progressive enhancement", () => {
    expect(render()).toContain("gsap.min.js");
  });

  it("inline dashboard script parses without syntax errors", () => {
    const html = render();
    const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
      (m) => m[1] ?? "",
    );
    expect(blocks.length).toBeGreaterThan(0);
    for (const code of blocks) {
      // Intentional: validates generated template JS parses in a browser.
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      expect(() => new Function(code)).not.toThrow();
    }
  });

  it("dashboard script wires state to the DOM", async () => {
    class Classes {
      readonly set = new Set<string>();
      add(c: string): void {
        this.set.add(c);
      }
      remove(c: string): void {
        this.set.delete(c);
      }
    }
    interface FakeEl {
      textContent: string;
      innerHTML: string;
      title: string;
      value: string | number;
      scrollHeight: number;
      scrollTop: number;
      clientHeight: number;
      style: Record<string, string>;
      className: string;
      classList: Classes;
      attrs: Record<string, string>;
      getAttribute(name: string): string | null;
      setAttribute(name: string, value: string): void;
      addEventListener(): void;
      scrollIntoView(): void;
      querySelectorAll(selector: string): FakeEl[];
    }
    const makeEl = (attrs: Record<string, string> = {}): FakeEl => ({
      textContent: "",
      innerHTML: "",
      title: "",
      value: "",
      scrollHeight: 0,
      scrollTop: 0,
      clientHeight: 0,
      style: {},
      className: "",
      classList: new Classes(),
      attrs,
      getAttribute(name: string): string | null {
        return this.attrs[name] ?? null;
      },
      setAttribute(name: string, value: string): void {
        this.attrs[name] = value;
      },
      addEventListener(): void {},
      scrollIntoView(): void {},
      querySelectorAll(): FakeEl[] {
        return [];
      },
    });
    const loopButtons = ["off", "track", "queue"].map((v) =>
      makeEl({ "data-l": v }),
    );
    const fxButtons = ["bassboost", "nightcore", "vaporwave", "8d"].map((v) =>
      makeEl({ "data-f": v }),
    );
    const byId = new Map<string, FakeEl>();
    const loopSeg = makeEl();
    loopSeg.querySelectorAll = () => loopButtons;
    const fxRow = makeEl();
    fxRow.querySelectorAll = () => fxButtons;
    byId.set("loopSeg", loopSeg);
    byId.set("fxRow", fxRow);
    const getEl = (id: string): FakeEl => {
      let el = byId.get(id);
      if (!el) {
        el = makeEl();
        byId.set(id, el);
      }
      return el;
    };
    const fakeDocument = {
      activeElement: null,
      getElementById: (id: string) => getEl(id),
      addEventListener: () => {},
    };
    const fakeWindow = {
      gsap: undefined,
      matchMedia: () => ({ matches: true }),
      addEventListener: () => {},
    };
    const state = {
      currentTitle: "Test Song",
      currentChannelId: 8,
      queueLength: 2,
      durationMs: 200_000,
      positionMs: 30_000,
      playerState: "playing",
      volume: 25,
      loopMode: "track",
      currentFilter: "bassboost",
      tracksPlayed: 7,
      uptimeMs: 3_600_000,
      disconnects: { count: 2 },
      connected: true,
      version: "2.2.0",
      queue: [{ title: "A", requestedBy: "Dj" }, { title: "B" }],
      chat: [
        { ts: 1_700_000_000_000, from: "Ana", text: "hola!", outgoing: false },
        { ts: 1_700_000_001_000, from: "Bot", text: "OK", outgoing: true },
      ],
    };
    const fetchedUrls: string[] = [];
    const fakeFetch = (url: string): Promise<{ json: () => unknown }> => {
      fetchedUrls.push(String(url));
      return Promise.resolve({ json: () => state });
    };
    const html = render();
    const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
      .map((m) => m[1] ?? "")
      .join("\n");
    // Intentional: executes generated template JS against fake DOM globals.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const factory = new Function(
      "document",
      "window",
      "fetch",
      "setInterval",
      "setTimeout",
      "btoa",
      `${code};return {refresh:refresh};`,
    ) as (...args: unknown[]) => {
      refresh: () => void;
    };
    const api = factory(
      fakeDocument,
      fakeWindow,
      fakeFetch,
      () => 0,
      () => 0,
      () => "eA==",
    );
    fetchedUrls.length = 0;
    api.refresh();
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    // Single round trip per refresh: state carries queue + errors.
    expect(fetchedUrls).toEqual(["/api/state"]);
    expect(getEl("nt").textContent).toBe("Test Song");
    expect(getEl("tcur").textContent).toBe("0:30");
    expect(getEl("tdur").textContent).toBe("3:20");
    expect(getEl("nsState").textContent).toBe("PLAYING");
    expect(getEl("lamp").className).toContain("on");
    expect(getEl("ppBtn").innerHTML).toContain("9208");
    expect(getEl("vol").value).toBe(25);
    expect(getEl("volv").textContent).toBe("25%");
    expect(
      loopButtons
        .find((b) => b.attrs["data-l"] === "track")
        ?.classList.set.has("on"),
    ).toBe(true);
    expect(
      fxButtons
        .find((b) => b.attrs["data-f"] === "bassboost")
        ?.classList.set.has("on"),
    ).toBe(true);
    expect(getEl("stTracks").textContent).toBe("7");
    expect(getEl("uptime").textContent).toBe("up 1 h · 2 cortes");
    expect(getEl("ql").innerHTML).toContain("rmQ(1)");
    expect(getEl("ql").innerHTML).toContain("rmQ(2)");
    expect(getEl("ql").innerHTML).toContain('class="qr"');
    expect(getEl("ql").innerHTML).toContain("Dj");
    expect(getEl("chat").innerHTML).toContain("hola!");
    expect(getEl("chat").innerHTML).toContain("BOT");
    expect(getEl("chat").innerHTML).toContain("Ana");
  });

  it("shares the console design system across pages", () => {
    const pages = [
      renderDashboard(
        { connected: true, queueLength: 0, version: "2.2.0" },
        "admin",
        "secret",
      ),
      renderSettingsPage("admin", "secret"),
      renderCommandsPage("admin", "secret"),
      renderSetupWizard("admin", "secret"),
    ];
    for (const html of pages) {
      // Same tokens everywhere: no leftover slate-blue theme.
      expect(html).toContain("--am:#FBBF24");
      expect(html).toContain("--bl:#60A5FA");
      expect(html).toContain("--gn:#4ADE80");
      expect(html).toContain("--rd:#F87171");
      expect(html).not.toContain("#38bdf8");
      expect(html).not.toContain("#0f172a");
      expect(html).not.toContain("#FFB000");
      expect(html).not.toContain("#ff453a");
      expect(html).not.toContain("#3ddc84");
      expect(html).not.toContain("#8e8e93");
    }
    // Same brand on every nav.
    for (const html of pages.slice(0, 3)) {
      expect(html).toContain("RHAPSOD<b>.</b>");
    }
  });

  it("escapes the current title", () => {
    const html = render({ currentTitle: '<script>alert("x")</script>' });
    expect(html).not.toContain('<script>alert("x")</script>');
    expect(html).toContain("&lt;script&gt;");
  });
});
