import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import pino from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";

import { flushStores, openStores } from "../src/bootstrap/stores.js";
import { MetricsCollector } from "../src/observability/metrics.js";

const directories: string[] = [];

function freshDataDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "rhapsod-stores-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { force: true, recursive: true });
});

describe("openStores and flushStores", () => {
  it("writes pending changes of every store under the data directory", async () => {
    const dataDir = freshDataDir();
    const stores = openStores({
      dataDir,
      logger: pino({ level: "silent" }),
      metrics: new MetricsCollector(),
    });
    stores.preferences.addFavorite("uid-1", {
      id: "abc",
      source: "https://youtu.be/abc",
      title: "Artist - Song",
    });
    stores.listeningHistory.recordStart("uid-1", {
      id: "abc",
      title: "Artist - Song",
    });

    await flushStores(stores);

    expect(
      readFileSync(join(dataDir, "user-preferences.json"), "utf8"),
    ).toContain("Artist - Song");
    expect(existsSync(join(dataDir, "listening-history.json"))).toBe(true);
  });

  it("keeps saving the other stores when one flush fails", async () => {
    const dataDir = freshDataDir();
    const stores = openStores({
      dataDir,
      logger: pino({ level: "silent" }),
      metrics: new MetricsCollector(),
    });
    stores.preferences.addFavorite("uid-1", {
      id: "abc",
      source: "https://youtu.be/abc",
      title: "Artist - Song",
    });
    const failing = vi.fn(() => Promise.reject(new Error("disk full")));

    await expect(flushStores(stores, failing)).resolves.toBeUndefined();
    expect(failing).toHaveBeenCalledTimes(1);
    expect(existsSync(join(dataDir, "user-preferences.json"))).toBe(true);
  });
});
