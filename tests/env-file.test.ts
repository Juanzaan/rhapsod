import { describe, expect, it } from "vitest";

import {
  loadEnvFile,
  maskSecret,
  parseEnvFile,
  saveEnvFile,
} from "../src/panel/env-file.js";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("env-file", () => {
  it("parses KEY=VALUE lines", () => {
    const values = parseEnvFile(
      "RHAPSOD_TS3_HOST=voice.example.com\nRHAPSOD_PORT=9987\n\n# comment\n",
    );
    expect(values).toEqual({
      RHAPSOD_TS3_HOST: "voice.example.com",
      RHAPSOD_PORT: "9987",
    });
  });

  it("loads a missing file as empty", () => {
    const env = loadEnvFile(join(tmpdir(), "does-not-exist.env"));
    expect(env.values).toEqual({});
  });

  it("saves and reloads the same values", async () => {
    const dir = mkdtempSync(join(tmpdir(), "env-"));
    const path = join(dir, "rhapsod.env");
    await saveEnvFile(path, {
      RHAPSOD_TS3_HOST: "ts.example.com",
      RHAPSOD_VERBOSE: "true",
    });
    const env = loadEnvFile(path);
    expect(env.values.RHAPSOD_TS3_HOST).toBe("ts.example.com");
    expect(env.values.RHAPSOD_VERBOSE).toBe("true");
    rmSync(dir, { recursive: true, force: true });
  });

  it("drops empty values on save", async () => {
    const dir = mkdtempSync(join(tmpdir(), "env-"));
    const path = join(dir, "rhapsod.env");
    await saveEnvFile(path, {
      RHAPSOD_TS3_HOST: "ts.example.com",
      RHAPSOD_PASSWORD: "",
    });
    const content = readFileSync(path, "utf8");
    expect(content).toContain("RHAPSOD_TS3_HOST=ts.example.com");
    expect(content).not.toContain("RHAPSOD_PASSWORD");
    rmSync(dir, { recursive: true, force: true });
  });

  it("masks secrets while keeping a hint of the value", () => {
    expect(maskSecret("superSecret123")).toBe("su***23");
    expect(maskSecret("abcd")).toBe("****");
    expect(maskSecret("")).toBe("");
    expect(maskSecret(undefined)).toBe("");
  });
});

describe("saveEnvFile", () => {
  it("keeps comments and order, drops removed keys, appends new ones", async () => {
    const dir = mkdtempSync(join(tmpdir(), "env-"));
    const path = join(dir, "rhapsod.env");
    writeFileSync(
      path,
      "# TeamSpeak\nRHAPSOD_TS3_HOST=old.example.com\nRHAPSOD_VERBOSE=true\n\n# Panel\nRHAPSOD_PANEL_PORT=8080\n",
    );
    await saveEnvFile(path, {
      RHAPSOD_TS3_HOST: "new.example.com",
      RHAPSOD_PANEL_PORT: "8080",
      RHAPSOD_LOG_LEVEL: "debug",
    });
    expect(readFileSync(path, "utf8")).toBe(
      "# TeamSpeak\nRHAPSOD_TS3_HOST=new.example.com\n\n# Panel\nRHAPSOD_PANEL_PORT=8080\nRHAPSOD_LOG_LEVEL=debug\n",
    );
    rmSync(dir, { recursive: true, force: true });
  });

  it("refuses values that would inject another variable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "env-"));
    const path = join(dir, "rhapsod.env");
    writeFileSync(path, "RHAPSOD_TS3_NICKNAME=Rhapsod\n");
    await expect(
      saveEnvFile(path, { RHAPSOD_TS3_NICKNAME: "x\nNODE_OPTIONS=--inspect" }),
    ).rejects.toThrow(/line breaks/);
    expect(readFileSync(path, "utf8")).toBe("RHAPSOD_TS3_NICKNAME=Rhapsod\n");
    rmSync(dir, { recursive: true, force: true });
  });

  it.skipIf(process.platform === "win32")(
    "keeps the permission bits of the existing file",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "env-"));
      const path = join(dir, "rhapsod.env");
      writeFileSync(path, "RHAPSOD_TS3_HOST=a\n", { mode: 0o600 });
      await saveEnvFile(path, { RHAPSOD_TS3_HOST: "b" });
      expect(statSync(path).mode & 0o777).toBe(0o600);
      rmSync(dir, { recursive: true, force: true });
    },
  );
});
