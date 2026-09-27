import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve(import.meta.dirname, "../scripts/deploy.sh");

// The script drives systemd, sudo and a real checkout; here it runs against
// stubs in a sandbox. Needs bash, git and tar on PATH; skipped on Windows,
// where "bash" may resolve to WSL instead of the shell the stubs expect.
const describeUnix = describe.skipIf(process.platform === "win32");

interface Sandbox {
  readonly root: string;
  readonly app: string;
  readonly backups: string;
  readonly systemctlLog: string;
  readonly previous: string;
  readonly target: string;
}

const sandboxes: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function executable(path: string, body: string): void {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

function createSandbox(
  env = "RHAPSOD_PANEL_ENABLED=false\n",
  { daemonChanged = false } = {},
): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "rhapsod-deploy-"));
  sandboxes.push(root);
  const work = join(root, "work");
  mkdirSync(work);
  git(work, "init", "--quiet", "--initial-branch=main");
  git(work, "config", "user.email", "test@example.com");
  git(work, "config", "user.name", "test");
  writeFileSync(join(work, "version.txt"), "1\n");
  git(work, "add", ".");
  git(work, "commit", "--quiet", "-m", "v1");
  const previous = git(work, "rev-parse", "HEAD");
  writeFileSync(join(work, "version.txt"), "2\n");
  if (daemonChanged) {
    mkdirSync(join(work, "scripts"));
    writeFileSync(join(work, "scripts", "yt-dlp-daemon.py"), "# v2\n");
    git(work, "add", ".");
  }
  git(work, "commit", "--quiet", "-am", "v2");
  const target = git(work, "rev-parse", "HEAD");
  git(root, "clone", "--quiet", "--bare", work, "origin.git");

  const app = join(root, "app");
  git(root, "clone", "--quiet", join(root, "origin.git"), "app");
  git(app, "checkout", "--quiet", "--detach", previous);
  mkdirSync(join(app, "data"));
  writeFileSync(join(app, "data", "state.json"), "{}\n");
  writeFileSync(join(app, ".env"), env);

  const bin = join(root, "bin");
  mkdirSync(bin);
  const systemctlLog = join(root, "systemctl.log");
  const stateFile = join(root, "unit-state");
  writeFileSync(stateFile, "active\n");
  executable(
    join(bin, "systemctl"),
    `#!/bin/sh
echo "$*" >> "${systemctlLog}"
case "$1" in
  start) echo active > "${stateFile}" ;;
  stop) echo inactive > "${stateFile}" ;;
  is-active)
    if [ -n "$UNHEALTHY_AT" ] && [ "$(git -C "${app}" rev-parse HEAD)" = "$UNHEALTHY_AT" ]; then
      exit 1
    fi
    grep -q '^active$' "${stateFile}" ;;
  show) echo 0 ;;
esac
`,
  );
  // "sudo -u USER cmd..." stand-in: drop the user, run the command.
  executable(join(bin, "as-user"), '#!/bin/sh\nshift\nexec "$@"\n');
  // npm stand-in: "run build" fails when the checkout is at FAIL_BUILD_AT.
  executable(
    join(bin, "npm"),
    `#!/bin/sh
dir="$2"
if [ "$3" = "run" ] && [ -n "$FAIL_BUILD_AT" ] && [ "$(git -C "$dir" rev-parse HEAD)" = "$FAIL_BUILD_AT" ]; then
  echo "build failed" >&2
  exit 1
fi
`,
  );
  return {
    root,
    app,
    backups: join(root, "backups"),
    systemctlLog,
    previous,
    target,
  };
}

// Async on purpose: the idle test serves the fake panel from this process,
// so the script must not block the event loop.
function runDeploy(
  sandbox: Sandbox,
  args: readonly string[],
  env: Record<string, string> = {},
): Promise<{ status: number | null; output: string }> {
  return new Promise((done) => {
    const child = spawn(
      "bash",
      [
        script,
        "--app-dir",
        sandbox.app,
        "--backup-dir",
        sandbox.backups,
        ...args,
      ],
      {
        env: {
          ...process.env,
          PATH: `${join(sandbox.root, "bin")}:${process.env.PATH ?? ""}`,
          RHAPSOD_DEPLOY_SYSTEMCTL: join(sandbox.root, "bin", "systemctl"),
          RHAPSOD_DEPLOY_AS_USER: join(sandbox.root, "bin", "as-user"),
          RHAPSOD_DEPLOY_POLL_SECONDS: "1",
          RHAPSOD_DEPLOY_HEALTH_SECONDS: "6",
          RHAPSOD_DEPLOY_STABLE_SECONDS: "1",
          ...env,
        },
      },
    );
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("close", (status) => done({ status, output }));
  });
}

function systemctlCalls(sandbox: Sandbox): string[] {
  return existsSync(sandbox.systemctlLog)
    ? readFileSync(sandbox.systemctlLog, "utf8")
        .trim()
        .split("\n")
        .filter((line) => !/^(is-active|show)/.test(line))
    : [];
}

afterEach(() => {
  for (const dir of sandboxes.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describeUnix("scripts/deploy.sh", { timeout: 60_000 }, () => {
  it("stops, backs up, builds the target and starts it", async () => {
    const sandbox = createSandbox();
    const run = await runDeploy(sandbox, ["--force"]);
    expect(run.status, run.output).toBe(0);
    expect(git(sandbox.app, "rev-parse", "HEAD")).toBe(sandbox.target);
    expect(systemctlCalls(sandbox)).toEqual(["stop rhapsod", "start rhapsod"]);
    const backups = readdirSync(sandbox.backups);
    expect(backups).toHaveLength(1);
    const listing = execFileSync(
      "tar",
      ["--force-local", "-tzf", join(sandbox.backups, backups[0] ?? "")],
      { encoding: "utf8" },
    );
    expect(listing).toContain("data/state.json");
    expect(listing).toContain(".env");
  });

  it("rolls back to the previous commit when the build fails", async () => {
    const sandbox = createSandbox();
    const run = await runDeploy(sandbox, ["--force"], {
      FAIL_BUILD_AT: sandbox.target,
    });
    expect(run.status).not.toBe(0);
    expect(run.output).toContain("rolled back");
    expect(git(sandbox.app, "rev-parse", "HEAD")).toBe(sandbox.previous);
    expect(systemctlCalls(sandbox)).toEqual([
      "stop rhapsod",
      "stop rhapsod",
      "start rhapsod",
    ]);
  });

  it("restarts the daemon again when it rolls back a daemon change", async () => {
    const sandbox = createSandbox(undefined, { daemonChanged: true });
    const run = await runDeploy(sandbox, ["--force"], {
      UNHEALTHY_AT: sandbox.target,
    });
    expect(run.status).not.toBe(0);
    expect(run.output).toContain("rolled back");
    expect(git(sandbox.app, "rev-parse", "HEAD")).toBe(sandbox.previous);
    expect(systemctlCalls(sandbox)).toEqual([
      "stop rhapsod",
      "restart rhapsod-ytdlp-daemon",
      "start rhapsod",
      "stop rhapsod",
      "restart rhapsod-ytdlp-daemon",
      "start rhapsod",
    ]);
  });

  it("changes nothing on a dry run", async () => {
    const sandbox = createSandbox();
    const run = await runDeploy(sandbox, ["--dry-run"]);
    expect(run.status, run.output).toBe(0);
    expect(run.output).toContain("dry run");
    expect(git(sandbox.app, "rev-parse", "HEAD")).toBe(sandbox.previous);
    expect(systemctlCalls(sandbox)).toEqual([]);
  });

  it("does nothing when already at the target", async () => {
    const sandbox = createSandbox();
    git(sandbox.app, "checkout", "--quiet", "--detach", sandbox.target);
    const run = await runDeploy(sandbox, []);
    expect(run.status, run.output).toBe(0);
    expect(run.output).toContain("nothing to deploy");
    expect(systemctlCalls(sandbox)).toEqual([]);
  });

  it("refuses to restart without a way to check playback", async () => {
    const sandbox = createSandbox();
    const run = await runDeploy(sandbox, []);
    expect(run.status).not.toBe(0);
    expect(run.output).toContain("pass --force");
    expect(systemctlCalls(sandbox)).toEqual([]);
  });

  it("waits until the panel reports idle before stopping", async () => {
    const states = ["playing", "playing", "idle", "idle", "idle"];
    const seenAuth: string[] = [];
    const server: Server = createServer((request, response) => {
      seenAuth.push(request.headers.authorization ?? "");
      const body =
        request.url === "/api/state"
          ? JSON.stringify({ playerState: states.shift() ?? "idle" })
          : JSON.stringify({ connected: true });
      response.setHeader("content-type", "application/json");
      response.end(body);
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    try {
      const sandbox = createSandbox(
        `RHAPSOD_PANEL_ENABLED=true\nRHAPSOD_PANEL_PORT=${port}\nRHAPSOD_PANEL_USER=admin\nRHAPSOD_PANEL_PASSWORD="s3cret"\n`,
      );
      const run = await runDeploy(sandbox, []);
      expect(run.status, run.output).toBe(0);
      expect(run.output).toContain("player is playing; waiting for idle");
      expect(git(sandbox.app, "rev-parse", "HEAD")).toBe(sandbox.target);
      expect(seenAuth[0]).toBe(
        `Basic ${Buffer.from("admin:s3cret").toString("base64")}`,
      );
    } finally {
      server.close();
    }
  });
});
