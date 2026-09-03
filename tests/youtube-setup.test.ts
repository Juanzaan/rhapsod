import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createCookieSaver,
  createYoutubeHealthCheck,
} from "../src/panel/youtube-setup.js";

describe("createYoutubeHealthCheck", () => {
  it("ok con latencia cuando resuelve", async () => {
    const check = createYoutubeHealthCheck(() =>
      Promise.resolve("https://cdn.example.test/audio"),
    );
    const result = await check();
    expect(result.ok).toBe(true);
    expect(typeof result.ms).toBe("number");
  });

  it("falla con motivo sanitizado cuando no resuelve", async () => {
    const check = createYoutubeHealthCheck(() =>
      Promise.reject(new Error("sign in to confirm https://example.com/x")),
    );
    const result = await check();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("sign in to confirm");
    expect(result.error).not.toContain("https://example.com/x");
  });

  it("falla cuando la respuesta no es URL", async () => {
    const check = createYoutubeHealthCheck(() => Promise.resolve("no-url"));
    const result = await check();
    expect(result.ok).toBe(false);
  });
});

describe("createCookieSaver", () => {
  it("guarda con permisos 0600 y devuelve la ruta", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cookies-"));
    try {
      const target = join(dir, "sub", "youtube-cookies.txt");
      const save = createCookieSaver(target);
      const result = await save(
        "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\n",
      );
      expect(result.path).toBe(target);
      expect(readFileSync(target, "utf8")).toContain("Netscape");
      // Windows does not honor POSIX permission bits; enforce on POSIX.
      if (process.platform !== "win32") {
        expect(statSync(target).mode & 0o777).toBe(0o600);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rechaza contenido vacío", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cookies-"));
    try {
      const save = createCookieSaver(join(dir, "c.txt"));
      await expect(save("   ")).rejects.toThrow(/vacío/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rechaza contenido gigante", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cookies-"));
    try {
      const save = createCookieSaver(join(dir, "c.txt"));
      await expect(save("x".repeat(300 * 1024))).rejects.toThrow(
        /demasiado grande/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
