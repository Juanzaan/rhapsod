import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { Ts3IdentityStore } from "../src/adapters/ts3/identity-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("Ts3IdentityStore", () => {
  it("persists and reloads the same TeamSpeak identity", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rhapsod-identity-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "nested", "ts3-identity.txt");
    const store = new Ts3IdentityStore(path);

    const created = await store.loadOrCreate();
    const loaded = await store.loadOrCreate();

    expect(loaded.toString()).toBe(created.toString());
    if (process.platform !== "win32") {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }
  });
});
