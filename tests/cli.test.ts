import { describe, expect, it } from "vitest";
import { runCli, type CliDeps } from "../src/cli/run-cli.js";

const BASE_ENV = {
  RHAPSOD_TS3_HOST: "ts.example.com",
  RHAPSOD_PANEL_ENABLED: "true",
  RHAPSOD_PANEL_PORT: "8080",
  RHAPSOD_PANEL_PASSWORD: "0123456789abcdef",
  RHAPSOD_DATA_DIR: "/srv/rhapsod/data",
  RHAPSOD_YTDLP_PATH: "/usr/local/bin/yt-dlp",
  RHAPSOD_FFMPEG_PATH: "/usr/local/bin/ffmpeg",
  RHAPSOD_YTDLP_DAEMON_URL: "http://127.0.0.1:8765",
  RHAPSOD_YTDLP_EXTRACTOR_ARGS:
    "youtube:po_token_uri=http://127.0.0.1:4416/get_pot",
};

const HEALTHY = {
  connected: true,
  queueLength: 2,
  playerState: "playing",
  currentTitle: "Song",
  currentArtist: "Band",
  uptimeMs: 3_900_000,
  youtubeAuthHealthy: true,
  version: "4.0.0",
};

function panelFetch(status: number, body: unknown): CliDeps["fetch"] {
  return () => Promise.resolve(new Response(JSON.stringify(body), { status }));
}

function refused(): Promise<Response> {
  return Promise.reject(new Error("ECONNREFUSED"));
}

function harness(overrides: Partial<CliDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const saved: Array<{ path: string; values: Record<string, string> }> = [];
  const requests: Array<{ url: string; auth: string | null }> = [];
  const deps: CliDeps = {
    env: BASE_ENV,
    envFilePath: "/srv/rhapsod/.env",
    version: "4.0.0",
    nodeVersion: "v22.19.0",
    fetch: (url, init) => {
      requests.push({ url, auth: init.headers.Authorization ?? null });
      return Promise.resolve(
        new Response(JSON.stringify(HEALTHY), { status: 200 }),
      );
    },
    firstLine: (binary) =>
      Promise.resolve(
        binary.endsWith("ffmpeg")
          ? "ffmpeg version 7.1 Copyright (c) the FFmpeg developers"
          : "2026.09.01",
      ),
    canConnect: () => Promise.resolve(true),
    freeBytes: () => Promise.resolve(20 * 1024 ** 3),
    clockSynced: () => Promise.resolve(true),
    readText: () => Promise.resolve(undefined),
    saveEnv: (path, values) => {
      saved.push({ path, values });
      return Promise.resolve();
    },
    loadEnv: () => ({ RHAPSOD_TS3_HOST: "ts.example.com", KEEP: "1" }),
    generatePassword: () => "new-password-123",
    defaultFfmpeg: "ffmpeg",
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    ...overrides,
  };
  return { deps, out, err, saved, requests };
}

describe("rhapsod cli", () => {
  it("prints the version", async () => {
    const { deps, out } = harness();
    expect(await runCli(["version"], deps)).toBe(0);
    expect(out).toEqual(["4.0.0"]);
  });

  it("prints usage and fails on an unknown command", async () => {
    const { deps, err } = harness();
    expect(await runCli(["frobnicate"], deps)).toBe(2);
    expect(err.join("\n")).toContain("Unknown command: frobnicate");
    expect(await runCli([], deps)).toBe(2);
  });

  describe("status", () => {
    it("reads /api/health with the panel credentials", async () => {
      const { deps, out, requests } = harness();
      expect(await runCli(["status"], deps)).toBe(0);
      expect(requests).toEqual([
        {
          url: "http://127.0.0.1:8080/api/health",
          auth: `Basic ${Buffer.from("admin:0123456789abcdef").toString("base64")}`,
        },
      ]);
      const text = out.join("\n");
      expect(text).toContain('Player:     playing "Band - Song", 2 queued');
      expect(text).toContain("TeamSpeak:  connected");
      expect(text).toContain("Uptime:     1h 5m");
      expect(text).toContain("ssh -N -L 8080:127.0.0.1:8080");
      expect(text).not.toContain("0123456789abcdef");
    });

    it("shows a pending claim code", async () => {
      const { deps, out } = harness({
        readText: () => Promise.resolve("abcde-fghjk\n"),
      });
      await runCli(["status"], deps);
      expect(out.join("\n")).toContain("!claim abcde-fghjk");
    });

    it("reports reconnecting from a 503 body", async () => {
      const { deps, out } = harness({
        fetch: panelFetch(503, { ...HEALTHY, reconnecting: true }),
      });
      expect(await runCli(["status"], deps)).toBe(0);
      expect(out.join("\n")).toContain("TeamSpeak:  reconnecting");
    });

    it("fails when the panel does not answer", async () => {
      const { deps, out } = harness({
        fetch: refused,
      });
      expect(await runCli(["status"], deps)).toBe(1);
      expect(out.join("\n")).toContain(
        "not answering on http://127.0.0.1:8080 (ECONNREFUSED)",
      );
    });

    it("says when the panel refuses the saved password", async () => {
      const { deps, out } = harness({ fetch: panelFetch(401, {}) });
      expect(await runCli(["status"], deps)).toBe(1);
      expect(out.join("\n")).toContain("refused the password");
    });

    it("prints machine-readable state with --json", async () => {
      const { deps, out } = harness();
      expect(await runCli(["status", "--json"], deps)).toBe(0);
      expect(JSON.parse(out[0]!)).toEqual({
        version: "4.0.0",
        panel: "ok",
        playerState: "playing",
        connected: true,
        reconnecting: false,
        adminClaimPending: false,
      });
    });

    it("shows the notice verdict when something is open", async () => {
      const { deps, out } = harness({
        fetch: panelFetch(200, {
          ...HEALTHY,
          verdict: "degraded",
          openNotices: 2,
        }),
      });
      expect(await runCli(["status"], deps)).toBe(0);
      expect(out.join("\n")).toContain(
        "Notices:    degraded, 2 open notices; list them with !avisos",
      );
      out.length = 0;
      expect(await runCli(["status", "--json"], deps)).toBe(0);
      expect(JSON.parse(out[0]!)).toMatchObject({
        verdict: "degraded",
        openNotices: 2,
      });
    });

    it("prints no notice line while the verdict is ok", async () => {
      const { deps, out } = harness({
        fetch: panelFetch(200, { ...HEALTHY, verdict: "ok", openNotices: 0 }),
      });
      await runCli(["status"], deps);
      expect(out.join("\n")).not.toContain("Notices:");
    });

    it("stops on a config the bot would reject", async () => {
      const { deps, err } = harness({
        env: { ...BASE_ENV, RHAPSOD_PANEL_PORT: "99999" },
      });
      expect(await runCli(["status"], deps)).toBe(1);
      expect(err.join("\n")).toContain("RHAPSOD_PANEL_PORT");
    });
  });

  describe("doctor", () => {
    it("passes on a healthy install", async () => {
      const { deps, out } = harness();
      expect(await runCli(["doctor"], deps)).toBe(0);
      const text = out.join("\n");
      expect(text).toContain("ok    FFmpeg: ffmpeg version 7.1");
      expect(text).toContain(
        "ok    yt-dlp daemon: answering on 127.0.0.1:8765",
      );
      expect(text).toContain("ok    POT provider: answering on 127.0.0.1:4416");
      expect(text).toContain("All checks passed.");
      expect(text).not.toContain("0123456789abcdef");
    });

    it("fails an old Node.js", async () => {
      const { deps, out } = harness({ nodeVersion: "v22.18.0" });
      expect(await runCli(["doctor"], deps)).toBe(1);
      expect(out.join("\n")).toContain("FAIL  Node.js: v22.18.0");
    });

    it("fails a panel bound outside loopback", async () => {
      const { deps, out } = harness({
        env: { ...BASE_ENV, RHAPSOD_PANEL_HOST: "0.0.0.0" },
      });
      expect(await runCli(["doctor"], deps)).toBe(1);
      expect(out.join("\n")).toContain(
        "FAIL  Panel bind: RHAPSOD_PANEL_HOST=0.0.0.0 exposes the panel",
      );
    });

    it("names the service behind a closed port", async () => {
      const { deps, out } = harness({
        canConnect: (_host, port) => Promise.resolve(port !== 8765),
      });
      expect(await runCli(["doctor"], deps)).toBe(1);
      expect(out.join("\n")).toContain(
        "FAIL  yt-dlp daemon: nothing on 127.0.0.1:8765; check the rhapsod-ytdlp-daemon service",
      );
    });

    it("fails a binary that does not run", async () => {
      const { deps, out } = harness({
        firstLine: (binary) =>
          binary.endsWith("yt-dlp")
            ? Promise.reject(new Error("ENOENT"))
            : Promise.resolve("ffmpeg version 7.1"),
      });
      expect(await runCli(["doctor"], deps)).toBe(1);
      expect(out.join("\n")).toContain(
        "FAIL  yt-dlp: /usr/local/bin/yt-dlp did not run: ENOENT",
      );
    });

    it("suggests WARP for failing YouTube without it", async () => {
      const { deps, out } = harness({
        fetch: panelFetch(200, { ...HEALTHY, youtubeAuthHealthy: false }),
      });
      expect(await runCli(["doctor"], deps)).toBe(0);
      expect(out.join("\n")).toContain("RHAPSOD_WITH_WARP=1");
    });

    it("suggests cookies for failing YouTube behind WARP", async () => {
      const { deps, out } = harness({
        env: { ...BASE_ENV, RHAPSOD_WARP_PROXY: "socks5h://127.0.0.1:40000" },
        fetch: panelFetch(200, { ...HEALTHY, youtubeAuthHealthy: false }),
      });
      await runCli(["doctor"], deps);
      const text = out.join("\n");
      expect(text).toContain("failing even through WARP");
      expect(text).not.toContain("RHAPSOD_WITH_WARP");
    });

    it("warns on low disk and an unsynchronized clock", async () => {
      const { deps, out } = harness({
        freeBytes: () => Promise.resolve(500 * 1024 ** 2),
        clockSynced: () => Promise.resolve(false),
      });
      expect(await runCli(["doctor"], deps)).toBe(0);
      const text = out.join("\n");
      expect(text).toContain("WARN  Disk: 0.5 GiB free");
      expect(text).toContain("WARN  Clock: not synchronized");
      expect(text).toContain("0 failed, 2 warnings.");
    });

    it("warns on a degraded verdict and fails an unhealthy one", async () => {
      const degraded = harness({
        fetch: panelFetch(200, {
          ...HEALTHY,
          verdict: "degraded",
          openNotices: 1,
        }),
      });
      expect(await runCli(["doctor"], degraded.deps)).toBe(0);
      expect(degraded.out.join("\n")).toContain(
        "WARN  Notices: degraded, 1 open notice;",
      );
      const unhealthy = harness({
        fetch: panelFetch(200, {
          ...HEALTHY,
          verdict: "unhealthy",
          openNotices: 1,
        }),
      });
      expect(await runCli(["doctor"], unhealthy.deps)).toBe(1);
      expect(unhealthy.out.join("\n")).toContain("FAIL  Notices: unhealthy");
    });

    it("fails when the bot is not running", async () => {
      const { deps, out } = harness({
        fetch: refused,
      });
      expect(await runCli(["doctor"], deps)).toBe(1);
      expect(out.join("\n")).toContain("is the bot running?");
    });
  });

  it("writes a new panel password and keeps the other keys", async () => {
    const { deps, out, saved } = harness();
    expect(await runCli(["password"], deps)).toBe(0);
    expect(saved).toEqual([
      {
        path: "/srv/rhapsod/.env",
        values: {
          RHAPSOD_TS3_HOST: "ts.example.com",
          KEEP: "1",
          RHAPSOD_PANEL_PASSWORD: "new-password-123",
        },
      },
    ]);
    expect(out[0]).toBe("New panel password: new-password-123");
  });
});
