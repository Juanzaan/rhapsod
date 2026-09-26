import { readFileSync } from "node:fs";

// Under systemd Node runs dist/main.js directly, so npm_package_version is
// never set, and hardcoded strings went stale (the panel reported an old
// version, HTTP clients sent "Rhapsod/3.0"). This file sits two levels below
// package.json both as src/lib and as dist/lib.
export const APP_VERSION: string = (
  JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  ) as { version: string }
).version;

/** User-Agent for outbound HTTP, e.g. "Rhapsod/4.0.0 (apple-music)". */
export function rhapsodUserAgent(detail?: string): string {
  return detail === undefined
    ? `Rhapsod/${APP_VERSION}`
    : `Rhapsod/${APP_VERSION} (${detail})`;
}
