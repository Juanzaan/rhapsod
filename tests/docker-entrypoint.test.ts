import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve(import.meta.dirname, "../scripts/docker-entrypoint.sh");

// Runs the entrypoint outside a container, with the data directory in a
// temp dir and `env` as the command, to see what the process would get.
const describeUnix = describe.skipIf(process.platform === "win32");

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    chmodSync(dir, 0o700);
    rmSync(dir, { recursive: true, force: true });
  }
});

function dataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "rhapsod-entry-"));
  dirs.push(dir);
  return dir;
}

function run(dir: string, env: Record<string, string> = {}) {
  const result = spawnSync("bash", [script, "env"], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      RHAPSOD_ENV_FILE: join(dir, ".env"),
      ...env,
    },
  });
  const vars = new Map(
    result.stdout
      .split("\n")
      .filter((line) => line.startsWith("RHAPSOD_") || line.startsWith("X_"))
      .map((line) => [
        line.slice(0, line.indexOf("=")),
        line.slice(line.indexOf("=") + 1),
      ]),
  );
  return { code: result.status, stdout: result.stdout, vars };
}

describeUnix("docker entrypoint", () => {
  it("writes a private setup-mode env file and prints the password once", () => {
    const dir = dataDir();
    const first = run(dir);
    expect(first.code).toBe(0);
    const envFile = join(dir, ".env");
    const content = readFileSync(envFile, "utf8");
    expect(content).toContain("RHAPSOD_TS3_HOST=setup.invalid\n");
    expect(content).toContain("RHAPSOD_TS3_AUTO_CONNECT=false\n");
    expect(content).toContain(
      `RHAPSOD_YTDLP_COOKIES_PATH=${join(dir, "youtube-cookies.txt")}\n`,
    );
    expect(statSync(envFile).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, "youtube-cookies.txt")).mode & 0o777).toBe(0o600);
    const password = /RHAPSOD_PANEL_PASSWORD=([0-9a-f]{24})\n/.exec(
      content,
    )?.[1];
    expect(password).toBeDefined();
    expect(first.stdout).toContain(`panel login admin / ${password}`);
    expect(first.vars.get("RHAPSOD_PANEL_PASSWORD")).toBe(password);

    const second = run(dir);
    expect(second.stdout).not.toContain("panel login");
    expect(readFileSync(envFile, "utf8")).toBe(content);
  });

  it("connects right away when RHAPSOD_TS3_HOST is set on the container", () => {
    const dir = dataDir();
    const result = run(dir, { RHAPSOD_TS3_HOST: "ts.example.com" });
    const content = readFileSync(join(dir, ".env"), "utf8");
    expect(content).not.toContain("setup.invalid");
    expect(content).toContain("RHAPSOD_TS3_AUTO_CONNECT=true\n");
    expect(result.vars.get("RHAPSOD_TS3_HOST")).toBe("ts.example.com");
  });

  it("exports file values the way dotenv reads them, container values first", () => {
    const dir = dataDir();
    writeFileSync(
      join(dir, ".env"),
      [
        "# comment",
        "RHAPSOD_TS3_HOST=ts.example.com",
        'RHAPSOD_TS3_NICKNAME="Rhapsod Bot"',
        "RHAPSOD_PANEL_HOST=0.0.0.0",
        "  RHAPSOD_LOG_LEVEL = debug  ",
        "X_OTHER=kept-out",
        "NODE_OPTIONS=--require /tmp/evil.js",
      ].join("\n"),
    );
    const result = run(dir, { RHAPSOD_PANEL_HOST: "127.0.0.1" });
    expect(result.vars.get("RHAPSOD_TS3_HOST")).toBe("ts.example.com");
    expect(result.vars.get("RHAPSOD_TS3_NICKNAME")).toBe("Rhapsod Bot");
    expect(result.vars.get("RHAPSOD_PANEL_HOST")).toBe("127.0.0.1");
    expect(result.vars.get("RHAPSOD_LOG_LEVEL")).toBe("debug");
    expect(result.vars.has("X_OTHER")).toBe(false);
    expect(result.stdout).not.toContain("NODE_OPTIONS");
  });

  // Root ignores the mode bits, so this only runs as another user.
  it.skipIf(process.getuid?.() === 0)(
    "starts without writing when the data directory is read-only",
    () => {
      const dir = dataDir();
      chmodSync(dir, 0o500);
      const result = run(dir);
      expect(result.code).toBe(0);
      expect(result.stdout).not.toContain("panel login");
      expect(result.vars.get("RHAPSOD_ENV_FILE")).toBe(join(dir, ".env"));
    },
  );
});
