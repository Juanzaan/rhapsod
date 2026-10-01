import { describe, expect, it } from "vitest";

import {
  renderCommandsPage,
  renderDashboard,
  renderServerPage,
  renderSettingsPage,
  renderSetupWizard,
} from "../src/panel/panel-templates.js";
import type { PanelStatus } from "../src/panel/panel-server.js";
import { AMBIENCE_JS, songHue } from "../src/panel/dashboard-design.js";

// The templates emit bare <script> tags; plain index lookups read them back
// without a tag-matching regexp, which CodeQL flags as an incomplete HTML
// filter even in tests.
function scriptBlocks(html: string): string[] {
  const blocks: string[] = [];
  let start = html.indexOf("<script>");
  while (start !== -1) {
    const end = html.indexOf("</script>", start);
    if (end === -1) break;
    blocks.push(html.slice(start + "<script>".length, end));
    start = html.indexOf("<script>", end);
  }
  return blocks;
}

function render(status: Partial<PanelStatus> = {}): string {
  return renderDashboard({
    connected: true,
    queueLength: 0,
    version: "2.2.0",
    ...status,
  });
}

describe("renderDashboard console", () => {
  it("persists scene choices, ignores the OS reduced-motion setting, pauses hidden tabs", () => {
    const values = new Map<string, string>();
    const attrs = new Map<string, string>();
    let reduced = false;
    const button = {
      textContent: "",
      disabled: false,
      setAttribute: (key: string, value: string) => attrs.set(key, value),
    };
    const scene = { value: "" };
    const document = {
      hidden: false,
      documentElement: {
        setAttribute: (key: string, value: string) => attrs.set(key, value),
      },
      getElementById: (id: string) =>
        id === "motionToggle"
          ? button
          : id === "scene"
            ? scene
            : {
                setAttribute: (key: string, value: string) =>
                  attrs.set(key, value),
              },
      addEventListener: () => {},
    };
    const window = {
      localStorage: {
        getItem: (key: string) => values.get(key),
        setItem: (key: string, value: string) => values.set(key, value),
      },
      matchMedia: () => ({ matches: reduced }),
    };
    // Generated browser code is exercised with controlled storage and motion preferences.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const factory = new Function(
      "window",
      "document",
      `${AMBIENCE_JS};return {initAmbience,setScene,toggleMotion,applyMotion};`,
    ) as (
      window: unknown,
      document: unknown,
    ) => {
      initAmbience(): void;
      setScene(value: string): void;
      toggleMotion(): void;
      applyMotion(): void;
    };
    const api = factory(window, document);
    api.initAmbience();
    api.setScene("ocean");
    expect(values.get("rhapsod.scene")).toBe("ocean");
    // The OS reduced-motion setting is ignored (owner's call: Windows sets
    // it with animation effects off); only the button stops motion.
    reduced = true;
    api.applyMotion();
    expect(attrs.get("data-motion")).toBe("running");
    expect(button.textContent).toBe("Pausar movimiento");
    api.toggleMotion();
    expect(attrs.get("data-motion")).toBe("paused");
    expect(values.get("rhapsod.motion")).toBe("paused");
    api.toggleMotion();
    expect(attrs.get("data-motion")).toBe("running");
    reduced = false;
    document.hidden = true;
    api.applyMotion();
    expect(attrs.get("data-motion")).toBe("paused");
    api.setScene("unexpected");
    expect(scene.value).toBe("aurora");
  });

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
    expect(html).toContain("SONANDO");
    expect(
      render({ currentTitle: "Song", currentRequester: "<Ana>" }),
    ).toContain("Pedido por <b>&lt;Ana&gt;</b>");
    // Lists without scrollbars announce rows that do not fit.
    expect(html).toContain('id="qlMore"');
    expect(html).toContain('id="srvMore"');
    expect(html).toContain("más abajo");
    expect(html).toContain("1:00");
    expect(html).toContain("3:20");
  });

  it("renders standby state without position", () => {
    const html = render();
    expect(html).toContain("EN ESPERA");
    expect(html).toContain("--:--");
  });

  it("renders loop, filters, queue actions and drawers", () => {
    const html = render({ queueLength: 2 });
    for (const id of [
      "loopSeg",
      "srvTree",
      "srvCount",
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

  it("ships no third-party subresources", () => {
    // Every script/style is inline: a hanging CDN stalls window load and the
    // tab spinner forever, and the CSP blocks third-party scripts anyway.
    const html = render();
    expect(html).not.toContain("<script src=");
    expect(html).not.toContain('rel="stylesheet" href="http');
  });

  it("inline dashboard script parses without syntax errors", () => {
    const html = render();
    const blocks = scriptBlocks(html);
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
    const byId = new Map<string, FakeEl>();
    const loopSeg = makeEl();
    loopSeg.querySelectorAll = () => loopButtons;
    byId.set("loopSeg", loopSeg);
    const autoButtons = ["on", "off"].map((v) => makeEl({ "data-a": v }));
    const autoSeg = makeEl();
    autoSeg.querySelectorAll = () => autoButtons;
    byId.set("autoSeg", autoSeg);
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
      autoplay: true,
      tracksPlayed: 7,
      uptimeMs: 3_600_000,
      disconnects: { count: 2 },
      connected: true,
      version: "2.2.0",
      queue: [{ title: "A", requestedBy: "Dj" }, { title: "B" }],
      notices: [
        {
          key: "ts3.no-talk-power",
          severity: "error",
          title: "Sin <b>talk power</b>",
          detail: "Darle talk power al bot.",
          ignored: false,
          since: Date.now() - 5 * 60_000,
          count: 3,
        },
        {
          key: "disk.data-low",
          severity: "warning",
          title: "Poco disco",
          detail: "Liberar espacio en data/.",
          ignored: true,
          since: Date.now(),
          count: 1,
        },
      ],
      chat: [
        { ts: 1_700_000_000_000, from: "Ana", text: "hola!", outgoing: false },
        { ts: 1_700_000_001_000, from: "Bot", text: "OK", outgoing: true },
      ],
      server: {
        version: 1,
        botChannelId: 20,
        channels: [
          { cid: 30, name: "Zulu", parentCid: 10, order: 2 },
          { cid: 10, name: "Lobby", order: 1 },
          { cid: 20, name: "Alpha", parentCid: 10, order: 1 },
        ],
        clients: [{ clid: 7, name: "Ana", cid: 20 }],
      },
    };
    const fetchedUrls: string[] = [];
    const fakeFetch = (url: string): Promise<{ json: () => unknown }> => {
      fetchedUrls.push(String(url));
      return Promise.resolve({ json: () => state });
    };
    const html = render();
    const code = scriptBlocks(html).join("\n");
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
    expect(getEl("nsState").textContent).toBe("SONANDO");
    expect(getEl("lamp").className).toBe("status on");
    expect(getEl("stxt").textContent).toBe("Conectado");
    // Autoplay used to show neither button as active.
    expect(autoButtons.map((b) => b.attrs["aria-pressed"])).toEqual([
      "true",
      "false",
    ]);
    expect(loopButtons.map((b) => b.attrs["aria-pressed"])).toEqual([
      "false",
      "true",
      "false",
    ]);
    expect(getEl("ppBtn").innerHTML).toContain("9208");
    expect(getEl("vol").value).toBe(25);
    expect(getEl("volv").textContent).toBe("25%");
    expect(
      loopButtons
        .find((b) => b.attrs["data-l"] === "track")
        ?.classList.set.has("on"),
    ).toBe(true);
    expect(getEl("stTracks").textContent).toBe("7");
    expect(getEl("uptime").textContent).toBe("up 1 h · 2 cortes");
    expect(getEl("ql").innerHTML).toContain("rmQ(1,this)");
    expect(getEl("ql").innerHTML).toContain("rmQ(2,this)");
    expect(getEl("ql").innerHTML).toContain('class="qr"');
    expect(getEl("ql").innerHTML).toContain("Dj");
    expect(getEl("chat").innerHTML).toContain("hola!");
    expect(getEl("chat").innerHTML).toContain("BOT");
    expect(getEl("chat").innerHTML).toContain("Ana");
    const srv = getEl("srvTree").innerHTML;
    expect(srv).toContain("Lobby");
    expect(srv).toContain("BOT");
    // TS order: Alpha (order 1) before Zulu (order 2) under Lobby.
    expect(srv.indexOf("Alpha")).toBeLessThan(srv.indexOf("Zulu"));
    expect(srv).toContain('onclick="moveBot(20)"');
    expect(getEl("srvCount").textContent).toBe("1 usuario");
    const noticesCard = getEl("noticesCard") as FakeEl & { hidden?: boolean };
    expect(noticesCard.hidden).toBe(false);
    expect(noticesCard.attrs["data-worst"]).toBe("error");
    expect(getEl("noticesCount").textContent).toBe("1 abierto · 1 ignorado");
    const notices = getEl("noticeList").innerHTML;
    expect(notices).toContain('<span class="sev sev-error">Error</span>');
    expect(notices).toContain("Sin &lt;b&gt;talk power&lt;/b&gt;");
    expect(notices).toContain("hace 5 min · 3 veces");
    expect(notices).toContain('data-key="ts3.no-talk-power"');
    expect(notices).not.toContain('data-key="disk.data-low"');
    expect(notices).toContain('class="notice ignored"');
    expect(notices).toContain("ignorado hasta que empeore");
  });

  it("shares the console design system across pages", () => {
    const pages = [
      renderDashboard({ connected: true, queueLength: 0, version: "2.2.0" }),
      renderSettingsPage(),
      renderCommandsPage(),
      renderSetupWizard(),
    ];
    for (const html of pages) {
      // Same tokens everywhere: no leftover amber or slate-blue theme.
      expect(html).toContain("--ac:#5BD38A");
      expect(html).toContain("--bl:#60A5FA");
      expect(html).toContain("--wn:#FBBF24");
      expect(html).toContain("--rd:#F87171");
      expect(html).not.toContain("#38bdf8");
      expect(html).not.toContain("#0f172a");
      expect(html).not.toContain("#FFB000");
      expect(html).not.toContain("#ff453a");
      expect(html).not.toContain("#3ddc84");
      expect(html).not.toContain("#8e8e93");
      expect(html).not.toContain("--am:");
      expect(html).not.toContain("--gn:");
    }
    // Same brand on every nav.
    for (const html of pages.slice(0, 3)) {
      expect(html).toContain('rhapsod<b aria-hidden="true"></b>');
    }
    // One connection pill with the same words on every page; the server
    // page used to say "EN VIVO" in its own style.
    for (const html of [...pages.slice(0, 3), renderServerPage()]) {
      expect(html).toContain('<div class="status');
      expect(html).toContain('id="stxt"');
      expect(html).not.toContain("EN VIVO");
    }
    for (const html of [pages[1], pages[2], renderServerPage()]) {
      expect(html).toContain("watchStatus();");
    }
    // Every page hides scrollbars and loads the self-hosted faces.
    for (const html of pages) {
      expect(html).toContain('<div class="intro" id="intro"');
      expect(html).toContain('sessionStorage.getItem("rhapsod.intro")');
      expect(html).not.toContain("@media(prefers-reduced-motion");
      expect(html).toContain("scrollbar-width:none");
      expect(html).toContain("url(/fonts/instrument-sans.woff2)");
    }
  });

  it("puts loop, autoplay, radio and library in one card without repeats", () => {
    const html = renderDashboard({
      connected: true,
      queueLength: 0,
      version: "4.0.0",
    });
    expect(html).not.toContain("discovery-card");
    expect(html).not.toContain('class="section-no"');
    // Mezclar/Vaciar live in the queue footer, Letra/Historial in the player.
    expect(html.match(/cmd\('shuffle'\)/g)).toHaveLength(1);
    expect(html.match(/showOut\('history'\)/g)).toHaveLength(1);
    // Said elsewhere on the same screen: the player shows playback state,
    // the nav links to Comandos, the placeholder explains the search box.
    for (const repeated of [
      "ON AIR",
      "Búsqueda o enlace",
      "Explorá todos los comandos",
      'id="nc2"',
    ]) {
      expect(html).not.toContain(repeated);
    }
  });

  it("server page has live tree markers", () => {
    const html = renderServerPage();
    for (const id of ["tree", "lamp"]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain("/api/server");
    expect(html).toContain("moveBot(");
  });

  it("server script renders nested tree with bot pill", async () => {
    interface FakeEl {
      textContent: string;
      innerHTML: string;
      classList: { add(text: string): void; remove(text: string): void };
    }
    const els = new Map<string, FakeEl>();
    const getEl = (id: string): FakeEl => {
      let el = els.get(id);
      if (!el) {
        el = {
          textContent: "",
          innerHTML: "",
          classList: { add: () => {}, remove: () => {} },
        };
        els.set(id, el);
      }
      return el;
    };
    const calls: { url: string; options?: unknown }[] = [];
    const fakeFetch = (url: string, options?: unknown) =>
      Promise.resolve({
        json: () =>
          Promise.resolve(
            String(url).includes("/api/move") ? { ok: true } : {},
          ),
      }).then((res) => {
        calls.push({ url: String(url), options });
        return res;
      });
    const html = renderServerPage();
    const code = scriptBlocks(html).join("\n");
    // Intentional: executes generated template JS against fake DOM globals.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const factory = new Function(
      "document",
      "window",
      "fetch",
      "setInterval",
      "setTimeout",
      "btoa",
      `${code};return {render:render,poll:poll,moveBot:moveBot,toggleCh:toggleCh};`,
    ) as (...args: unknown[]) => {
      render: (view: unknown) => void;
      poll: () => void;
      moveBot: (cid: number) => void;
      toggleCh: (event: unknown, cid: number) => void;
    };
    const api = factory(
      { getElementById: getEl, readyState: "loading" },
      {
        matchMedia: () => ({ matches: true }),
        addEventListener: () => {},
      },
      fakeFetch,
      () => 0,
      () => 0,
      () => "eA==",
    );
    api.render({
      version: 1,
      botChannelId: 2,
      channels: [
        { cid: 1, name: "Lobby" },
        { cid: 2, name: "Music", parentCid: 1 },
        { cid: 3, name: "Sub", parentCid: 2 },
        { cid: 4, name: "[cspacer01]Hub" },
        { cid: 5, name: "<b>x</b>" },
        { cid: 6, name: "Empty orphan", parentCid: 999 },
      ],
      clients: [
        { clid: 7, name: "Ana", cid: 2 },
        { clid: 8, name: "Beto", cid: 2 },
        { clid: 9, name: "Cid", cid: 3 },
      ],
    });
    const tree = getEl("tree").innerHTML;
    expect(tree).toContain("BOT");
    // Spacer labels render as plain headers, never as channels.
    expect(tree).toContain('<div class="spacer">Hub</div>');
    expect(tree).not.toContain("moveBot(4)");
    expect(tree).not.toContain("cspacer");
    expect(tree).not.toContain("<b>x</b>");
    expect(tree).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(tree).toContain("Empty orphan");
    expect(tree).toContain("Vacío");
    expect(tree.indexOf("Music")).toBeLessThan(tree.indexOf("Sub"));
    expect(tree.match(/onclick="moveBot\(2\)"/)).not.toBeNull();
    // Nested kids container + chevron toggle for channels with children.
    expect(tree).toContain('data-kids="2"');
    expect(tree).toContain("toggleCh(event,2)");
    api.toggleCh({ stopPropagation: () => {} }, 2);
    expect(getEl("tree").innerHTML).toContain('style="display:none"');
    api.toggleCh({ stopPropagation: () => {} }, 2);
    expect(getEl("tree").innerHTML).not.toContain('style="display:none"');
    // Mode hint reflects the background discovery state.
    expect(getEl("treeHint").textContent).toContain("Vista parcial");
    expect(getEl("visibilityNote").textContent).toContain("Vista limitada");
    api.render({
      version: 2,
      botChannelId: 2,
      mode: "full",
      channels: [{ cid: 1, name: "Lobby" }],
      clients: [],
    });
    expect(getEl("treeHint").textContent).toBe(
      "Hacé clic en un canal para mover el bot ahí",
    );

    api.poll();
    api.moveBot(3);
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    const urls = calls.map((c) => c.url);
    expect(urls).toContain("/api/server");
    const moveCall = calls.find((c) => c.url === "/api/move");
    expect(moveCall).toBeDefined();
    expect(
      (moveCall?.options as { body?: string } | undefined)?.body,
    ).toContain('"cid":3');
  });

  function renderTreeHtml(view: {
    version: number;
    botChannelId: number;
    mode?: string;
    channels: {
      cid: number;
      name: string;
      parentCid?: number;
      order?: number;
    }[];
    clients: { clid: number; name: string; cid: number }[];
  }): string {
    const els = new Map<string, { innerHTML: string; textContent: string }>();
    const getEl = (id: string) => {
      let el = els.get(id);
      if (!el) {
        el = { innerHTML: "", textContent: "" };
        els.set(id, el);
      }
      return el;
    };
    const html = renderServerPage();
    const code = scriptBlocks(html).join("\n");
    // Intentional: executes generated template JS against fake DOM globals.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const factory = new Function(
      "document",
      "window",
      "fetch",
      "setInterval",
      "setTimeout",
      "btoa",
      `${code};return {render:render};`,
    ) as (...args: unknown[]) => { render: (view: unknown) => void };
    const api = factory(
      {
        getElementById: (id: string) =>
          id === "channelSearch" ? { value: "" } : getEl(id),
        readyState: "loading",
      },
      { matchMedia: () => ({ matches: false }), addEventListener: () => {} },
      () => Promise.resolve({ json: () => Promise.resolve({}) }),
      () => 0,
      () => 0,
      () => "eA==",
    );
    api.render(view);
    return getEl("tree").innerHTML;
  }

  it("server page leaves an unchanged tree in place between polls", () => {
    // Rewriting identical markup every 2.5s replaced the nodes under the
    // pointer and cut hover transitions mid-way.
    let treeWrites = 0;
    let treeHtml = "";
    const tree = {
      get innerHTML(): string {
        return treeHtml;
      },
      set innerHTML(value: string) {
        treeWrites++;
        treeHtml = value;
      },
    };
    const els = new Map<string, unknown>([["tree", tree]]);
    const getEl = (id: string): unknown => {
      if (!els.has(id)) els.set(id, { textContent: "", value: "" });
      return els.get(id);
    };
    const code = scriptBlocks(renderServerPage()).join("\n");
    // Intentional: executes generated template JS against fake DOM globals.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const factory = new Function(
      "document",
      "window",
      "fetch",
      "setInterval",
      "setTimeout",
      `${code};return {render:render,toggleCh:toggleCh};`,
    ) as (...args: unknown[]) => {
      render: (view: unknown) => void;
      toggleCh: (event: unknown, cid: number) => void;
    };
    const api = factory(
      { getElementById: getEl, readyState: "loading" },
      { matchMedia: () => ({ matches: true }), addEventListener: () => {} },
      () => Promise.resolve({ json: () => Promise.resolve({}) }),
      () => 0,
      () => 0,
    );
    const view = {
      version: 1,
      botChannelId: 1,
      mode: "full",
      channels: [
        { cid: 1, name: "Lobby" },
        { cid: 2, name: "Music", parentCid: 1 },
      ],
      clients: [{ clid: 7, name: "Ana", cid: 2 }],
    };
    api.render(view);
    api.render(structuredClone(view));
    api.render(structuredClone(view));
    expect(treeWrites).toBe(1);
    expect(treeHtml).toContain("Music");

    api.toggleCh(null, 1);
    expect(treeWrites).toBe(2);
  });

  it("shows spacer labels as headers, never as channels", () => {
    // Spacers are server-side decoration ([spacer]/[cspacer]/[rspacer]/
    // [lspacer], optional * and number): labels render as plain headers
    // with no row, no move and no counts; line spacers render nothing.
    const tree = renderTreeHtml({
      version: 1,
      botChannelId: 2,
      mode: "full",
      channels: [
        { cid: 1, name: "Lobby" },
        { cid: 2, name: "Music", parentCid: 1 },
        { cid: 4, name: "[cspacer01]Hub" },
        { cid: 5, name: "[spacer02]---" },
        { cid: 6, name: "[rspacer]News" },
        { cid: 7, name: "[*spacer03]-" },
        { cid: 8, name: "[lspacer7]Left" },
        // Hiding decoration never hides music: subchannels of a spacer
        // render under the spacer's own parent.
        { cid: 9, name: "Hidden Gem", parentCid: 4 },
      ],
      clients: [],
    });
    for (const label of ["Hub", "News", "Left"]) {
      expect(tree).toContain(`<div class="spacer">${label}</div>`);
    }
    for (const raw of [
      "cspacer",
      "rspacer",
      "lspacer",
      "[spacer",
      "[*spacer",
      "---",
    ]) {
      expect(tree).not.toContain(raw);
    }
    for (const cid of [4, 5, 6, 7, 8]) {
      expect(tree).not.toContain(`moveBot(${cid})`);
    }
    expect(tree).toContain("Lobby");
    expect(tree).toContain("Music");
    expect(tree).toContain("Hidden Gem");
  });

  it("orders siblings by the channel_order chain, not the numeric value", () => {
    // channel_order is the cid below which a channel sorts (0 first):
    // numeric values only match TeamSpeak when cids grow in order.
    const tree = renderTreeHtml({
      version: 1,
      botChannelId: 99,
      mode: "full",
      channels: [
        { cid: 30, name: "First", order: 0 },
        { cid: 12, name: "Second", order: 30 },
        { cid: 20, name: "Third", order: 12 },
      ],
      clients: [],
    });
    const first = tree.indexOf("First");
    const second = tree.indexOf("Second");
    const third = tree.indexOf("Third");
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
  });

  it("escapes the current title", () => {
    const html = render({ currentTitle: '<script>alert("x")</script>' });
    expect(html).not.toContain('<script>alert("x")</script>');
    expect(html).toContain("&lt;script&gt;");
  });

  it("wizard save enables auto-connect only when a host is set", () => {
    // The installer ships AUTO_CONNECT=false so the bot boots panel-only for
    // the wizard; completing the wizard must flip it back — but only together
    // with a real host, never on its own. Executed like the server-script
    // test: run the generated wizard JS against fake DOM globals.
    interface FakeInput {
      textContent: string;
      innerHTML: string;
      value: string;
      disabled: boolean;
      classList: { add(): void; remove(): void };
    }
    const runSave = (
      hostValue: string,
    ): { url: string; body: string | undefined }[] => {
      const els = new Map<string, FakeInput>();
      const getEl = (id: string): FakeInput => {
        let el = els.get(id);
        if (!el) {
          el = {
            textContent: "",
            innerHTML: "",
            value: "",
            disabled: false,
            classList: { add: () => {}, remove: () => {} },
          };
          els.set(id, el);
        }
        return el;
      };
      els.set("ih", {
        textContent: "",
        innerHTML: "",
        value: hostValue,
        disabled: false,
        classList: { add: () => {}, remove: () => {} },
      });
      const puts: { url: string; body: string | undefined }[] = [];
      const fakeFetch = (url: unknown, options?: unknown) => {
        const opts = options as { method?: string; body?: string } | undefined;
        if (opts?.method === "PUT") {
          puts.push({ url: String(url), body: opts.body });
        }
        return Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
      };
      const html = renderSetupWizard();
      const code = scriptBlocks(html).join("\n");
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const factory = new Function(
        "document",
        "window",
        "fetch",
        "setTimeout",
        "btoa",
        `${code};return {save:save};`,
      ) as (...args: unknown[]) => { save: () => void };
      const fakeDocument = {
        getElementById: getEl,
        querySelector: () => getEl("bp"),
      };
      const api = factory(
        fakeDocument,
        { location: { href: "" } },
        fakeFetch,
        () => 0,
        () => "eA==",
      );
      api.save();
      return puts;
    };

    const withHost = runSave("ts.example.com");
    const envPut = withHost.find((p) => p.url === "/api/env");
    expect(envPut).toBeDefined();
    expect(envPut?.body).toContain('"RHAPSOD_TS3_AUTO_CONNECT":"true"');
    expect(envPut?.body).toContain('"RHAPSOD_TS3_HOST":"ts.example.com"');

    const withoutHost = runSave("");
    const barePut = withoutHost.find((p) => p.url === "/api/env");
    expect(barePut).toBeDefined();
    const parsed = JSON.parse(barePut?.body ?? "{}") as Record<string, unknown>;
    expect(parsed.RHAPSOD_TS3_AUTO_CONNECT).toBeUndefined();
  });

  it("settings save skips untouched masked secrets", () => {
    // Masked entries render empty with a "(sin cambios)" placeholder. Sending
    // them back empty would make the server delete the secrets, so save()
    // must omit them — a regression test for wiped panel/TS passwords.
    interface FakeSettingInput {
      dataset: { key: string };
      placeholder: string;
      value: string;
    }
    const inputs: FakeSettingInput[] = [
      {
        dataset: { key: "RHAPSOD_TS3_HOST" },
        placeholder: "",
        value: "new.example.com",
      },
      {
        dataset: { key: "RHAPSOD_PANEL_PASSWORD" },
        placeholder: "(sin cambios)",
        value: "",
      },
      {
        dataset: { key: "RHAPSOD_TS3_PASSWORD" },
        placeholder: "(sin cambios)",
        value: "retyped",
      },
    ];
    const puts: { url: string; body: string | undefined }[] = [];
    const fakeFetch = (url: unknown, options?: unknown) => {
      const opts = options as { method?: string; body?: string } | undefined;
      if (opts?.method === "PUT") {
        puts.push({ url: String(url), body: opts.body });
      }
      return Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
    };
    const fakeDocument = {
      getElementById: () => ({
        classList: { add: () => {}, remove: () => {} },
        innerHTML: "",
        textContent: "",
      }),
      querySelectorAll: () => inputs,
    };
    const html = renderSettingsPage();
    const code = scriptBlocks(html).join("\n");
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const factory = new Function(
      "document",
      "window",
      "fetch",
      "setTimeout",
      "btoa",
      `${code};return {save:save};`,
    ) as (...args: unknown[]) => { save: () => void };
    const api = factory(
      fakeDocument,
      { location: { href: "" } },
      fakeFetch,
      () => 0,
      () => "eA==",
    );
    api.save();
    const envPut = puts.find((p) => p.url === "/api/env");
    expect(envPut).toBeDefined();
    const parsed = JSON.parse(envPut?.body ?? "{}") as Record<string, unknown>;
    expect(parsed.RHAPSOD_TS3_HOST).toBe("new.example.com");
    expect(parsed.RHAPSOD_TS3_PASSWORD).toBe("retyped");
    expect(parsed).not.toHaveProperty("RHAPSOD_PANEL_PASSWORD");
  });

  it("settings load tells auth apart from connection failures", async () => {
    const runLoad = async (
      fetchImpl: (url: unknown, options?: unknown) => Promise<unknown>,
    ): Promise<string> => {
      const ct = { html: "" };
      const doc = {
        getElementById: (id: string) => {
          if (id === "ct") {
            return {
              classList: { add: () => {}, remove: () => {} },
              textContent: "",
              set innerHTML(value: string) {
                ct.html = value;
              },
              get innerHTML(): string {
                return ct.html;
              },
            };
          }
          return {
            classList: { add: () => {}, remove: () => {} },
            innerHTML: "",
            textContent: "",
          };
        },
      };
      const html = renderSettingsPage();
      const code = scriptBlocks(html).join("\n");
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const factory = new Function(
        "document",
        "window",
        "fetch",
        "setTimeout",
        "btoa",
        `${code};return {};`,
      ) as (...args: unknown[]) => unknown;
      factory(
        doc,
        { location: { href: "" } },
        fetchImpl,
        () => 0,
        () => "eA==",
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      return ct.html;
    };

    const failing = await runLoad(() => Promise.reject(new Error("down")));
    expect(failing).toContain("Sin conexi");
    expect(failing).toContain("Reintentar");

    const denied = await runLoad(() =>
      Promise.resolve({ json: () => Promise.resolve({}), status: 401 }),
    );
    expect(denied).toContain("No autorizado");

    const broken = await runLoad(() =>
      Promise.resolve({ json: () => Promise.resolve({}), status: 500 }),
    );
    expect(broken).toContain("http500");
    const loaded = await runLoad(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            entries: [
              {
                key: "RHAPSOD_PANEL_HOST",
                value: "<private>",
                editable: false,
              },
              {
                key: "RHAPSOD_FFMPEG_PATH",
                value: "ffmpeg",
                description: "Ruta del binario ffmpeg (solo lectura)",
                editable: false,
              },
              {
                key: "RHAPSOD_TS3_HOST",
                value: "voice.example.com",
                description: "Server <name>",
                editable: true,
              },
            ],
          }),
      }),
    );
    expect(loaded).toContain("&lt;private&gt;");
    expect(loaded).toContain("RHAPSOD_PANEL_HOST (solo lectura)");
    expect(loaded).toContain("Ruta del binario ffmpeg (solo lectura)<");
    expect(loaded).not.toContain("(solo lectura) (solo lectura)");
    expect(loaded).toContain("Server &lt;name&gt;");
    expect(loaded).toContain('id="saveSettings"');
  });
});

describe("panel credentials", () => {
  it("never embeds basic-auth credentials in page source", () => {
    const pages = [
      renderDashboard({ connected: true, queueLength: 0, version: "3.0.0" }),
      renderSettingsPage(),
      renderCommandsPage(),
      renderSetupWizard(),
      renderServerPage(),
    ];
    for (const html of pages) {
      expect(html).not.toContain("btoa(");
      expect(html).not.toMatch(/authorization/i);
    }
  });
});

describe("dashboard motion", () => {
  interface MotionApi {
    hashHue(title: string): number;
    setSongHue(title: string): number;
    restoreSongHue(): void;
    fx(el: unknown, frames: unknown, opts: unknown): unknown;
    fxPress(el: unknown): void;
    setHtml(el: unknown, html: string): boolean;
    fxCount(el: unknown, to: number, suffix?: string): void;
    setLive(on: boolean): void;
  }

  function motionHarness(options: { paused?: boolean; inlineHue?: string }) {
    const styles = new Map<string, string>();
    if (options.inlineHue !== undefined)
      styles.set("--song-h", options.inlineHue);
    const attrs = new Map<string, string>([
      ["data-motion", options.paused ? "paused" : "running"],
    ]);
    const stored = new Map<string, string>();
    const document = {
      documentElement: {
        getAttribute: (key: string) => attrs.get(key) ?? null,
        setAttribute: (key: string, value: string) => attrs.set(key, value),
        style: {
          setProperty: (key: string, value: string) => styles.set(key, value),
          getPropertyValue: (key: string) => styles.get(key) ?? "",
        },
      },
    };
    const window = {
      localStorage: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value),
      },
    };
    // Generated browser code is exercised against controlled globals.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const factory = new Function(
      "window",
      "document",
      `${AMBIENCE_JS};return {hashHue,setSongHue,restoreSongHue,fx,fxPress,setHtml,fxCount,setLive};`,
    ) as (window: unknown, document: unknown) => MotionApi;
    return { api: factory(window, document), attrs, styles, stored };
  }

  it("colors each track the same way on the server and in the browser", () => {
    const { api } = motionHarness({});
    for (const title of [
      "Daft Punk - Something About Us",
      "Khruangbin - María También",
      "a",
      "",
    ]) {
      expect(api.hashHue(title)).toBe(songHue(title));
    }
    expect(songHue(undefined)).toBe(142);
    const html = render({ currentTitle: "Bonobo - Kerala" });
    expect(html).toContain(`style="--song-h:${songHue("Bonobo - Kerala")}"`);
  });

  it("stores the track color and reuses it on pages without a track", () => {
    const dashboard = motionHarness({});
    const hue = dashboard.api.setSongHue("Tycho - Awake");
    expect(dashboard.styles.get("--song-h")).toBe(String(hue));
    expect(dashboard.stored.get("rhapsod.hue")).toBe(String(hue));

    const other = motionHarness({});
    other.stored.set("rhapsod.hue", "210");
    other.api.restoreSongHue();
    expect(other.styles.get("--song-h")).toBe("210");

    // A server-rendered color for the current track wins over the stored one.
    const rendered = motionHarness({ inlineHue: "33" });
    rendered.stored.set("rhapsod.hue", "210");
    rendered.api.restoreSongHue();
    expect(rendered.styles.get("--song-h")).toBe("33");
  });

  it("skips script animations while motion is paused", () => {
    const calls: unknown[] = [];
    const el = {
      animate: (frames: unknown) => {
        calls.push(frames);
        return {};
      },
    };
    const running = motionHarness({});
    expect(running.api.fx(el, [{ opacity: 0 }], {})).not.toBeNull();
    const paused = motionHarness({ paused: true });
    expect(paused.api.fx(el, [{ opacity: 0 }], {})).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("keeps click feedback while background motion is paused", () => {
    const calls: unknown[] = [];
    const el = {
      animate: (frames: unknown) => {
        calls.push(frames);
        return {};
      },
    };
    motionHarness({ paused: true }).api.fxPress(el);
    expect(calls).toHaveLength(1);
  });

  it("writes markup only when it changed", () => {
    const { api } = motionHarness({});
    let writes = 0;
    const el = {
      set innerHTML(_value: string) {
        writes++;
      },
    };
    expect(api.setHtml(el, "<li>a</li>")).toBe(true);
    expect(api.setHtml(el, "<li>a</li>")).toBe(false);
    expect(api.setHtml(el, "<li>b</li>")).toBe(true);
    expect(writes).toBe(2);
  });

  it("sets counters directly when animation is unavailable", () => {
    const { api } = motionHarness({});
    const attrs = new Map<string, string>([["data-v", "3"]]);
    const el = {
      textContent: "3",
      getAttribute: (key: string) => attrs.get(key) ?? null,
      setAttribute: (key: string, value: string) => attrs.set(key, value),
    };
    api.fxCount(el, 12, " pistas");
    expect(el.textContent).toBe("12 pistas");
    expect(attrs.get("data-v")).toBe("12");
  });

  it("marks the page live only while playing", () => {
    const { api, attrs } = motionHarness({});
    api.setLive(true);
    expect(attrs.get("data-live")).toBe("true");
    api.setLive(false);
    expect(attrs.get("data-live")).toBe("false");
    expect(render({ playerState: "playing" })).toContain('data-live="true"');
    expect(render({ playerState: "paused" })).toContain('data-live="false"');
  });

  it("offers no audio filter controls", () => {
    const html = render({ playerState: "playing", currentTitle: "Song" });
    for (const removed of [
      "fxRow",
      "bassboost",
      "nightcore",
      "vaporwave",
      "filter off",
    ]) {
      expect(html).not.toContain(removed);
    }
  });

  it("renders the turntable, equalizer and local motion without a library", () => {
    const html = render({ playerState: "playing", currentTitle: "Song" });
    expect(html).toContain('class="tonearm"');
    expect(html).toContain('class="eq"');
    expect(html).toContain('class="orb"');
    expect(html).not.toContain("gsap");
    for (const page of [
      renderServerPage(),
      renderSettingsPage(),
      renderCommandsPage(),
    ]) {
      expect(page).not.toContain("gsap");
      expect(page).toContain("function initMotion");
    }
  });
});

describe("panel pages motion and feedback", () => {
  function pageScript(html: string): string {
    return scriptBlocks(html).join("\n");
  }

  const quietWindow = { matchMedia: () => ({ matches: false }) };
  const pendingFetch = () => new Promise(() => undefined);

  it("highlights command search matches without trusting the text", () => {
    const document = {
      getElementById: () => ({ addEventListener: () => {} }),
      addEventListener: () => {},
    };
    // Generated browser code is exercised against controlled globals.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const factory = new Function(
      "window",
      "document",
      "fetch",
      "btoa",
      `${pageScript(renderCommandsPage())};return {hl};`,
    ) as (...args: unknown[]) => { hl: (text: string, q: string) => string };
    const { hl } = factory(quietWindow, document, pendingFetch, () => "");
    expect(hl("Buscar una radio y sintonizar la radio", "radio")).toBe(
      "Buscar una <mark>radio</mark> y sintonizar la <mark>radio</mark>",
    );
    expect(hl('<img src=x onerror="x">radio', "radio")).toBe(
      "&lt;img src=x onerror=&quot;x&quot;&gt;<mark>radio</mark>",
    );
    expect(hl("Play", "")).toBe("Play");
  });

  it("counts unsaved settings and clears them after saving", () => {
    const fieldClasses = new Map<unknown, boolean>();
    const makeInput = (value: string, defaultValue: string) => {
      const parentNode = {
        classList: {
          toggle: (_name: string, on: boolean) =>
            fieldClasses.set(parentNode, on),
        },
      };
      return { value, defaultValue, parentNode };
    };
    const inputs = [
      makeInput("Rhapsod DJ", "Rhapsod"),
      makeInput("9987", "9987"),
    ];
    const note = { textContent: "" };
    const barClasses = new Set<string>();
    const bar = {
      classList: {
        toggle: (name: string, on: boolean) =>
          on ? barClasses.add(name) : barClasses.delete(name),
        add: (name: string) => barClasses.add(name),
        remove: (name: string) => barClasses.delete(name),
      },
    };
    const document = {
      getElementById: (id: string) =>
        id === "saveNote"
          ? note
          : id === "saveBar"
            ? bar
            : { addEventListener: () => {} },
      querySelectorAll: () => inputs,
      addEventListener: () => {},
    };
    // Generated browser code is exercised against controlled globals.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const factory = new Function(
      "window",
      "document",
      "fetch",
      "btoa",
      `${pageScript(renderSettingsPage())};return {markDirty,markSaved};`,
    ) as (...args: unknown[]) => { markDirty(): void; markSaved(): void };
    const api = factory(quietWindow, document, pendingFetch, () => "");
    api.markDirty();
    expect(note.textContent).toContain("1 cambio sin guardar");
    expect(barClasses.has("dirty")).toBe(true);
    expect(fieldClasses.get(inputs[0]?.parentNode)).toBe(true);
    expect(fieldClasses.get(inputs[1]?.parentNode)).toBe(false);
    api.markSaved();
    expect(barClasses.has("dirty")).toBe(false);
    expect(barClasses.has("saved")).toBe(true);
    expect(inputs[0]?.defaultValue).toBe("Rhapsod DJ");
    expect(note.textContent).toContain("Guardado");
  });

  it("labels settings by meaning and keeps the variable name visible", () => {
    const html = renderSettingsPage();
    expect(html).toContain('class="fk"');
    expect(html).toContain("e.description || e.key");
  });
});
