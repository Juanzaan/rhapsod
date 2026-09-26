import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { APP_VERSION, rhapsodUserAgent } from "../src/lib/version.js";

describe("version", () => {
  it("reads the version from package.json", () => {
    const pkg = JSON.parse(
      readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"),
    ) as { version: string };
    expect(APP_VERSION).toBe(pkg.version);
  });

  it("builds User-Agent strings from it", () => {
    // Regression: outbound requests said "Rhapsod/3.0" or "Rhapsod/1"
    // whatever the running version was.
    expect(rhapsodUserAgent()).toBe(`Rhapsod/${APP_VERSION}`);
    expect(rhapsodUserAgent("audio-probe")).toBe(
      `Rhapsod/${APP_VERSION} (audio-probe)`,
    );
  });
});
