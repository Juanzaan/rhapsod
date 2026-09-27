import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AdminClaim,
  generateClaimCode,
} from "../src/application/admin-claim.js";

describe("AdminClaim", () => {
  let dir: string;
  let codePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rhapsod-claim-"));
    codePath = join(dir, "admin-claim-code");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function open(adminUids = new Set<string>(), persist = vi.fn()) {
    return AdminClaim.open({
      adminUids,
      codePath,
      persist,
      generateCode: () => "abcde-fghjk",
    });
  }

  it("writes a code for the installer when no admin is configured", async () => {
    const claim = await open();
    expect(claim.code).toBe("abcde-fghjk");
    expect(readFileSync(codePath, "utf8")).toBe("abcde-fghjk\n");
  });

  it("keeps the same code across restarts", async () => {
    writeFileSync(codePath, "mnpqr-stuvw\n");
    const claim = await open();
    expect(claim.code).toBe("mnpqr-stuvw");
  });

  it("stays closed and removes a stale code once an admin exists", async () => {
    writeFileSync(codePath, "mnpqr-stuvw\n");
    const claim = await open(new Set(["owner"]));
    expect(claim.code).toBeUndefined();
    expect(() => readFileSync(codePath)).toThrow();
    await expect(claim.claim("someone", "mnpqr-stuvw")).resolves.toEqual({
      status: "closed",
    });
  });

  it("makes the first sender with the code admin and saves it", async () => {
    const adminUids = new Set<string>();
    const persist = vi.fn(() => Promise.resolve());
    const claim = await open(adminUids, persist);
    await expect(claim.claim("uid-1", " ABCDE fghjk ")).resolves.toEqual({
      status: "claimed",
      persisted: true,
    });
    expect(adminUids.has("uid-1")).toBe(true);
    expect(persist).toHaveBeenCalledWith(["uid-1"]);
    expect(claim.code).toBeUndefined();
    expect(() => readFileSync(codePath)).toThrow();
    await expect(claim.claim("uid-2", "abcde-fghjk")).resolves.toEqual({
      status: "closed",
    });
    expect(adminUids.has("uid-2")).toBe(false);
  });

  it("grants admin for this run when the env file cannot be written", async () => {
    const adminUids = new Set<string>();
    const claim = await open(
      adminUids,
      vi.fn(() => Promise.reject(new Error("EACCES"))),
    );
    await expect(claim.claim("uid-1", "abcde-fghjk")).resolves.toEqual({
      status: "claimed",
      persisted: false,
    });
    expect(adminUids.has("uid-1")).toBe(true);
  });

  it("locks after five wrong codes, even for the right one", async () => {
    const claim = await open();
    for (let i = 0; i < 4; i++) {
      await expect(claim.claim("x", "wrong")).resolves.toEqual({
        status: "wrong-code",
      });
    }
    await expect(claim.claim("x", "wrong")).resolves.toEqual({
      status: "locked",
    });
    await expect(claim.claim("x", "abcde-fghjk")).resolves.toEqual({
      status: "locked",
    });
  });

  it("still opens when the code cannot be written", async () => {
    const claim = await AdminClaim.open({
      adminUids: new Set(),
      codePath: join(dir, "missing", "admin-claim-code"),
      persist: vi.fn(),
      generateCode: () => "abcde-fghjk",
    });
    expect(claim.code).toBe("abcde-fghjk");
  });

  it("generates readable ten-character codes", () => {
    const code = generateClaimCode();
    expect(code).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
    expect(code).not.toMatch(/[01ilo]/);
  });
});
