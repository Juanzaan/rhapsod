import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { panelScript } from "../src/panel/panel-scripts.js";
import {
  renderCommandsPage,
  renderDashboard,
  renderServerPage,
  renderSettingsPage,
  renderSetupWizard,
} from "../src/panel/panel-templates.js";

const SCRIPTS_DIR = join(import.meta.dirname, "..", "src", "panel", "scripts");

const PAGES: Readonly<Record<string, () => string>> = {
  commands: renderCommandsPage,
  dashboard: () =>
    renderDashboard({ connected: false, queueLength: 0, version: "0.0.0" }),
  server: renderServerPage,
  settings: renderSettingsPage,
  setup: renderSetupWizard,
};

/** Splits a page into its inline script code and the markup around it. */
function splitPage(html: string): { code: string; markup: string } {
  let code = "";
  let markup = "";
  let from = 0;
  let start = html.indexOf("<script>");
  while (start !== -1) {
    const end = html.indexOf("</script>", start);
    markup += html.slice(from, start);
    code += html.slice(start + "<script>".length, end);
    from = end + "</script>".length;
    start = html.indexOf("<script>", from);
  }
  return { code, markup: markup + html.slice(from) };
}

describe("panel browser scripts", () => {
  it("never close the inline <script> they are embedded in", () => {
    for (const file of readdirSync(SCRIPTS_DIR)) {
      const text = readFileSync(join(SCRIPTS_DIR, file), "utf8");
      expect(text.toLowerCase(), file).not.toContain("</script");
    }
  });

  it("inline the files into the pages that use them", () => {
    const commands = renderCommandsPage();
    expect(commands).toContain(panelScript("commands"));
    expect(commands).toContain(panelScript("ambience"));
  });

  it.each(Object.keys(PAGES))(
    "define every function the %s page calls from inline handlers",
    (name) => {
      // Only the static markup: handlers inside markup that scripts build
      // at runtime depend on options this check cannot see.
      const { code, markup } = splitPage(PAGES[name]!());
      const handlers = new Set<string>();
      for (const match of markup.matchAll(
        /\son[a-z]+="([A-Za-z_$][\w$]*)\(/g,
      )) {
        handlers.add(match[1]!);
      }
      handlers.delete("if");
      for (const handler of handlers) {
        expect(code, `${name}: ${handler}`).toMatch(
          new RegExp(`function ${handler.replace("$", "\\$")}\\(`),
        );
      }
    },
  );
});
