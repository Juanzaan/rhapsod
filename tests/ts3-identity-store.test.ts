import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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

  it("recovers from a corrupt identity file by generating a fresh one", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rhapsod-identity-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "ts3-identity.txt");
    await writeFile(path, "not-a-valid-identity\n", "utf8");
    const store = new Ts3IdentityStore(path);

    const identity = await store.loadOrCreate();

    expect(identity.toString()).not.toBe("not-a-valid-identity");
  });

  it("recovers from a truncated identity file by generating a fresh one", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rhapsod-identity-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "ts3-identity.txt");
    await writeFile(path, "abc\n", "utf8");
    const store = new Ts3IdentityStore(path);

    const identity = await store.loadOrCreate();

    expect(identity.toString()).not.toBe("abc");
  });

  it("writes atomically and leaves no temporary file behind", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rhapsod-identity-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "ts3-identity.txt");
    const store = new Ts3IdentityStore(path);

    await store.loadOrCreate();

    expect((await readFile(path, "utf8")).trim().length).toBeGreaterThan(0);
    await expect(stat(`${path}.tmp`)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
