import { describe, expect, it } from "vitest";

import {
  loadEnvFile,
  maskSecret,
  parseEnvFile,
  saveEnvFile,
} from "../src/panel/env-file.js";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
