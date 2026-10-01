import { readFileSync } from "node:fs";

/** Browser scripts under src/panel/scripts, copied to dist by the build. */
export type PanelScriptName =
  | "ambience"
  | "commands"
  | "dashboard"
  | "intro"
  | "server"
  | "server-tree"
  | "settings"
  | "setup";

const cache = new Map<PanelScriptName, string>();

/**
 * The panel's browser code lives in real .js files so ESLint and
 * `tsc -p tsconfig.panel.json` check it, but pages still inline it: the
 * CSP allows inline scripts only, and a localhost panel gains nothing from
 * extra requests.
 */
export function panelScript(name: PanelScriptName): string {
  let text = cache.get(name);
  if (text === undefined) {
    text = readFileSync(
      new URL(`./scripts/${name}.js`, import.meta.url),
      "utf8",
    );
    cache.set(name, text);
  }
  return text;
}
