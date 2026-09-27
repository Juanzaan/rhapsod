import { describe, expect, it } from "vitest";

import {
  cookiesFinding,
  daemonFallbackFinding,
  diskFinding,
  isLoopbackHost,
  panelBindFinding,
  potEndpoint,
  reconnectingFinding,
  restartLoopFinding,
  summarizeCookiesFile,
  youtubeAuthFinding,
} from "../src/application/notices/detectors.js";

const DAY = 24 * 60 * 60 * 1_000;
const MB = 1024 * 1024;
const NOW = Date.UTC(2026, 8, 27);

function cookieLine(
  name: string,
  expirySeconds: number,
  domain = ".youtube.com",
): string {
  return [
    domain,
    "TRUE",
    "/",
    "TRUE",
    String(expirySeconds),
    name,
    "secret",
  ].join("\t");
}

const HEADER = "# Netscape HTTP Cookie File";

describe("youtubeAuthFinding", () => {
  it("maps each canary category to its own detector", () => {
    expect(youtubeAuthFinding("cookies-invalid", false).detector).toBe(
      "youtube.cookies-invalid",
    );
    expect(youtubeAuthFinding("extraction-failed", false).detector).toBe(
      "youtube.extraction-failed",
    );
    const soft = youtubeAuthFinding("soft-block", false);
    expect(soft.detector).toBe("youtube.soft-block");
    expect(soft.detailEs).toContain("RHAPSOD_WITH_WARP=1");
    expect(youtubeAuthFinding("soft-block", true).detailEs).not.toContain(
      "RHAPSOD_WITH_WARP",
    );
  });
});

describe("daemonFallbackFinding", () => {
  it("waits for three failures in a row", () => {
    const snapshot = {
      state: "failing" as const,
      consecutiveFailures: 2,
      fallbacksTotal: 2,
    };
    expect(daemonFallbackFinding(snapshot)).toBeUndefined();
    expect(
      daemonFallbackFinding({
        ...snapshot,
        consecutiveFailures: 3,
        lastFailureReason: "timeout",
      })?.data,
    ).toEqual({ consecutiveFailures: 3, reason: "timeout" });
  });
});

describe("reconnectingFinding", () => {
  it("warns for two attempts and errors after", () => {
    expect(reconnectingFinding(2, 5).severity).toBe("warning");
    expect(reconnectingFinding(3, 5).severity).toBe("error");
  });
});

describe("restartLoopFinding", () => {
  it("fires on four starts inside 15 minutes", () => {
    const starts = [NOW - 20 * 60_000, NOW - 10 * 60_000, NOW - 5 * 60_000];
    expect(restartLoopFinding([...starts, NOW], NOW)).toBeUndefined();
    expect(
      restartLoopFinding([NOW - 60_000, ...starts, NOW], NOW)?.data,
    ).toEqual({ starts: 4 });
  });
});

describe("panelBindFinding", () => {
  it("accepts every loopback spelling", () => {
    for (const host of [
      "127.0.0.1",
      "127.1.2.3",
      "localhost",
      "::1",
      "[::1]",
    ]) {
      expect(isLoopbackHost(host)).toBe(true);
    }
    for (const host of ["0.0.0.0", "::", "10.0.0.5", "127.example.com"]) {
      expect(isLoopbackHost(host)).toBe(false);
    }
  });

  it("is critical only while the panel is enabled on a public address", () => {
    expect(
      panelBindFinding({
        RHAPSOD_PANEL_ENABLED: false,
        RHAPSOD_PANEL_HOST: "0.0.0.0",
      }),
    ).toBeUndefined();
    const finding = panelBindFinding({
      RHAPSOD_PANEL_ENABLED: true,
      RHAPSOD_PANEL_HOST: "0.0.0.0",
    });
    expect(finding?.severity).toBe("critical");
    expect(finding?.detailEs).toContain("RHAPSOD_PANEL_HOST=127.0.0.1");
  });
});

describe("diskFinding", () => {
  it("warns under 1 GB, errors under 200 MB and clears 10 % above", () => {
    expect(diskFinding(150 * MB, false)).toMatchObject({ severity: "error" });
    expect(diskFinding(900 * MB, false)).toMatchObject({
      severity: "warning",
      data: { freeMb: 900 },
    });
    expect(diskFinding(1050 * MB, true)).toBe("hold");
    expect(diskFinding(1050 * MB, false)).toBe("ok");
    expect(diskFinding(1200 * MB, true)).toBe("ok");
  });
});

describe("summarizeCookiesFile", () => {
  it("reports the earliest sign-in expiry and never the values", () => {
    const text = [
      HEADER,
      cookieLine("SAPISID", NOW / 1_000 + 30 * 86_400),
      `#HttpOnly_${cookieLine("__Secure-3PSID", NOW / 1_000 + 10 * 86_400)}`,
      cookieLine("PREF", NOW / 1_000 + 86_400),
      cookieLine("SID", NOW / 1_000 + 5 * 86_400, ".google.com"),
      cookieLine("LOGIN_INFO", 0),
    ].join("\n");
    const summary = summarizeCookiesFile(text);
    expect(summary).toEqual({
      ok: true,
      hasHeader: true,
      youtubeCookies: 4,
      authExpiresAt: NOW + 10 * DAY,
    });
    expect(JSON.stringify(summary)).not.toContain("secret");
  });

  it("flags files with spaces instead of tabs, and empty files", () => {
    expect(
      summarizeCookiesFile(`${HEADER}\n.youtube.com TRUE / TRUE 0 SID x`),
    ).toEqual({ ok: false, reason: "malformed" });
    expect(summarizeCookiesFile(`${HEADER}\n\n`)).toEqual({
      ok: false,
      reason: "empty",
    });
  });

  it("notices a missing header and reads CRLF files", () => {
    expect(summarizeCookiesFile(`${cookieLine("SID", 0)}\r\n`)).toMatchObject({
      ok: true,
      hasHeader: false,
      youtubeCookies: 1,
    });
  });
});

describe("cookiesFinding", () => {
  const summary = (days: number) =>
    summarizeCookiesFile(
      [HEADER, cookieLine("SAPISID", (NOW + days * DAY) / 1_000)].join("\n"),
    );

  it("errors when the file is missing, unusable or expired", () => {
    expect(cookiesFinding("missing", NOW, false)).toMatchObject({
      severity: "error",
    });
    expect(
      cookiesFinding({ ok: false, reason: "malformed" }, NOW, false),
    ).toMatchObject({ severity: "error" });
    expect(
      cookiesFinding(
        summarizeCookiesFile(`${HEADER}\n${cookieLine("SID", 0, ".x.com")}`),
        NOW,
        false,
      ),
    ).toMatchObject({ severity: "error" });
    expect(cookiesFinding(summary(-1), NOW, false)).toMatchObject({
      severity: "error",
      titleEs: "Las cookies de YouTube vencieron",
    });
  });

  it("warns inside 14 days and clears only past 15", () => {
    expect(cookiesFinding(summary(10), NOW, false)).toMatchObject({
      severity: "warning",
      detailEs: expect.stringContaining("10 días") as unknown,
    });
    expect(cookiesFinding(summary(14.5), NOW, true)).toBe("hold");
    expect(cookiesFinding(summary(14.5), NOW, false)).toBe("ok");
    expect(cookiesFinding(summary(16), NOW, true)).toBe("ok");
  });

  it("warns about a missing header even with valid cookies", () => {
    const noHeader = summarizeCookiesFile(
      cookieLine("SAPISID", (NOW + 60 * DAY) / 1_000),
    );
    expect(cookiesFinding(noHeader, NOW, false)).toMatchObject({
      severity: "warning",
    });
  });
});

describe("potEndpoint", () => {
  it("reads po_token_uri or bgutil base_url from the extractor args", () => {
    expect(
      potEndpoint({
        RHAPSOD_YTDLP_EXTRACTOR_ARGS:
          "youtube:player_client=web_safari youtube:po_token_uri=http://localhost:4416",
      }),
    ).toEqual({ host: "localhost", port: 4416 });
    expect(
      potEndpoint({
        RHAPSOD_YTDLP_EXTRACTOR_ARGS:
          "youtubepot-bgutilhttp:base_url=http://[::1]:5000",
      }),
    ).toEqual({ host: "::1", port: 5000 });
  });

  it("falls back to the daemon's fixed port, or nothing", () => {
    expect(
      potEndpoint({ RHAPSOD_YTDLP_DAEMON_URL: "http://127.0.0.1:9000" }),
    ).toEqual({ host: "127.0.0.1", port: 4416 });
    expect(potEndpoint({})).toBeUndefined();
    expect(
      potEndpoint({ RHAPSOD_YTDLP_EXTRACTOR_ARGS: "youtube:po_token_uri=::" }),
    ).toBeUndefined();
  });
});
