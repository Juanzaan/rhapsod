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

  it("escapes the current title", () => {
    const html = render({ currentTitle: '<script>alert("x")</script>' });
    expect(html).not.toContain('<script>alert("x")</script>');
    expect(html).toContain("&lt;script&gt;");
  });
});
