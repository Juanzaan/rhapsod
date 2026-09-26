import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { formatSmoke, runSmoke } from "../scripts/smoke.js";

describe("smoke script", () => {
  it("starts the bot in setup mode, checks the panel and stops it", async () => {
    const result = await runSmoke({
      nodeArgs: [
        "--import",
        import.meta.resolve("tsx"),
        fileURLToPath(new URL("../src/main.ts", import.meta.url)),
      ],
    });
    // Before the setup-mode signal handlers, SIGTERM killed the process
    // outright and "stops on SIGTERM" failed.
    expect(result.ok, formatSmoke(result)).toBe(true);
  }, 60_000);
});
