import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// Self-hosted (OFL) instead of Google Fonts: the panel runs behind an SSH
// tunnel and its CSP allows nothing off-origin. Latin variable-weight files
// only (~110 KB total); Spanish accents are in the latin subset.
const FONT_FILES = {
  "bricolage.woff2":
    "@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2",
  "instrument-sans.woff2":
    "@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2",
  "jetbrains-mono.woff2":
    "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2",
} as const;

export type PanelFontName = keyof typeof FONT_FILES;

const require = createRequire(import.meta.url);
const cache = new Map<PanelFontName, Buffer>();

export function isPanelFont(name: string): name is PanelFontName {
  return Object.hasOwn(FONT_FILES, name);
}

export function panelFont(name: PanelFontName): Buffer {
  let data = cache.get(name);
  if (data === undefined) {
    data = readFileSync(require.resolve(FONT_FILES[name]));
    cache.set(name, data);
  }
  return data;
}

export const FONT_FACE_CSS = `
@font-face{font-family:'Bricolage Grotesque';src:url(/fonts/bricolage.woff2) format('woff2');font-weight:200 800;font-display:swap}
@font-face{font-family:'Instrument Sans';src:url(/fonts/instrument-sans.woff2) format('woff2');font-weight:400 700;font-display:swap}
@font-face{font-family:'JetBrains Mono';src:url(/fonts/jetbrains-mono.woff2) format('woff2');font-weight:100 800;font-display:swap}
`;
