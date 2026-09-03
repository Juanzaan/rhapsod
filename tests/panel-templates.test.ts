import { describe, expect, it } from "vitest";

import { renderDashboard } from "../src/panel/panel-templates.js";
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
      connected: true,
      version: "2.2.0",
      queue: [{ title: "A" }, { title: "B" }],
    };
    const fakeFetch = (url: string): Promise<{ json: () => unknown }> => {
      if (String(url).includes("/api/state")) {
        return Promise.resolve({ json: () => state });
      }
      return Promise.resolve({
        json: () => ({ totalErrors: 0, byCategory: {}, recent: [] }),
      });
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
    api.refresh();
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }

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
    expect(getEl("uptime").textContent).toBe("up 1 h");
    expect(getEl("ql").innerHTML).toContain("rmQ(1)");
    expect(getEl("ql").innerHTML).toContain("rmQ(2)");
  });

  it("escapes the current title", () => {
    const html = render({ currentTitle: '<script>alert("x")</script>' });
    expect(html).not.toContain('<script>alert("x")</script>');
    expect(html).toContain("&lt;script&gt;");
  });
});
