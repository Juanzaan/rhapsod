import { spawnSync } from "node:child_process";
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
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve(import.meta.dirname, "../scripts/rhapsod.sh");

// The wrapper drives systemd, journald and sudo; here it runs against stubs
// in a sandbox. Skipped on Windows, like the deploy script tests.
const describeUnix = describe.skipIf(process.platform === "win32");

const sandboxes: string[] = [];

afterEach(() => {
  for (const root of sandboxes.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function executable(path: string, body: string): void {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

function sandbox(playerState = "idle", activeUnits = "all") {
  const root = mkdtempSync(join(tmpdir(), "rhapsod-cli-"));
  sandboxes.push(root);
  const app = join(root, "app");
  mkdirSync(join(app, "dist"), { recursive: true });
  const calls = join(root, "calls.log");
  writeFileSync(calls, "");
  // Stands in for dist/cli.js: records its arguments and answers status.
  writeFileSync(
    join(app, "dist", "cli.js"),
    `const fs = require("node:fs");
fs.appendFileSync(${JSON.stringify(calls)}, "cli " + process.argv.slice(2).join(" ") + "\\n");
if (process.argv[2] === "status" && process.argv[3] === "--json") {
  process.stdout.write(JSON.stringify({ playerState: ${JSON.stringify(playerState)} }));
} else {
  process.stdout.write("cli output\\n");
}
`,
  );
  writeFileSync(join(app, "package.json"), '{"type":"commonjs"}');
  const conf = join(root, "install.conf");
  writeFileSync(
    conf,
    `APP_DIR=${app}\nAPP_USER=rhapsod\nNODE_BIN=${process.execPath}\n`,
  );
  const systemctl = join(root, "systemctl");
  executable(
    systemctl,
    `#!/usr/bin/env bash
echo "systemctl $*" >> ${JSON.stringify(calls)}
if [[ "$1" == "is-active" ]]; then
  unit="\${@: -1}"
  if [[ "${activeUnits}" == "all" || "$unit" != "bgutil-pot-provider" ]]; then
    [[ "$2" == "--quiet" ]] || echo active
    exit 0
  fi
  [[ "$2" == "--quiet" ]] || echo inactive
  exit 3
fi
`,
  );
  const journalctl = join(root, "journalctl");
  executable(
    journalctl,
    `#!/usr/bin/env bash\necho "journalctl $*" >> ${JSON.stringify(calls)}\n`,
  );
  // Drops the user argument, as sudo -u would after switching to it.
  const asUser = join(root, "as-user");
  executable(asUser, `#!/usr/bin/env bash\nshift\nexec "$@"\n`);
  // Stands in for deploy.sh: records its arguments and checks out --ref,
  // or fails like a rolled-back deploy when DEPLOY_FAILS is set.
  const deploy = join(root, "deploy.sh");
  executable(
    deploy,
    `#!/usr/bin/env bash
echo "deploy $*" >> ${JSON.stringify(calls)}
[[ -z "\${DEPLOY_FAILS:-}" ]] || exit 1
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "--ref" ]]; then git -C ${JSON.stringify(app)} checkout -q --detach "$2"; fi
  shift
done
`,
  );
  const userdel = join(root, "userdel");
  executable(
    userdel,
    `#!/usr/bin/env bash\necho "userdel $*" >> ${JSON.stringify(calls)}\n`,
  );
  const system = join(root, "system");
  mkdirSync(join(system, "etc", "systemd", "system"), { recursive: true });
  mkdirSync(join(system, "etc", "rhapsod"), { recursive: true });
  mkdirSync(join(system, "etc", "cron.weekly"), { recursive: true });
  mkdirSync(join(system, "usr", "local", "bin"), { recursive: true });
  for (const unit of [
    "rhapsod",
    "rhapsod-ytdlp-daemon",
    "bgutil-pot-provider",
  ]) {
    writeFileSync(
      join(system, "etc", "systemd", "system", `${unit}.service`),
      "",
    );
  }
  writeFileSync(join(system, "etc", "cron.weekly", "rhapsod-ytdlp-update"), "");
  writeFileSync(join(system, "usr", "local", "bin", "rhapsod"), "old");
  const backups = join(root, "backups");

  const run = (...args: string[]) => runWith({}, ...args);
  const runWith = (extra: Record<string, string>, ...args: string[]) => {
    const result = spawnSync("bash", [script, ...args], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        RHAPSOD_INSTALL_CONF: conf,
        RHAPSOD_SYSTEMCTL: systemctl,
        RHAPSOD_JOURNALCTL: journalctl,
        RHAPSOD_AS_USER: asUser,
        RHAPSOD_NO_SUDO: "1",
        RHAPSOD_DEPLOY: deploy,
        RHAPSOD_USERDEL: userdel,
        RHAPSOD_ROOT: system,
        RHAPSOD_BACKUP_DIR: backups,
        GIT_CONFIG_NOSYSTEM: "1",
        HOME: root,
        ...extra,
      },
    });
    return {
      code: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      calls: readFileSync(calls, "utf8"),
    };
  };
  return { run, runWith, conf, app, backups, system, calls };
}

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync(
    "git",
    ["-c", "user.name=test", "-c", "user.email=test@localhost", ...args],
    { cwd, encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

// Two tagged releases in a repository that is its own origin, installed at
// the older one, so update, rollback and backup run real git.
function withReleases(box: ReturnType<typeof sandbox>) {
  const { app } = box;
  mkdirSync(join(app, "data"), { recursive: true });
  writeFileSync(join(app, "data", "state.json"), "{}");
  writeFileSync(join(app, ".env"), "RHAPSOD_PANEL_PASSWORD=secret\n");
  writeFileSync(join(app, ".gitignore"), "data/\n.env\ndist/\n");
  const release = (version: string) => {
    writeFileSync(
      join(app, "package.json"),
      JSON.stringify({ name: "rhapsod", version, type: "commonjs" }, null, 2),
    );
    git(app, "add", "-A");
    git(app, "commit", "-q", "-m", version);
    git(app, "tag", `v${version}`);
    return git(app, "rev-parse", "HEAD");
  };
  git(app, "init", "-q");
  mkdirSync(join(app, "scripts"), { recursive: true });
  writeFileSync(join(app, "scripts", "rhapsod.sh"), "new");
  const first = release("4.0.0");
  const second = release("4.1.0");
  git(app, "remote", "add", "origin", app);
  git(app, "checkout", "-q", "--detach", "v4.0.0");
  return { first, second };
}

describeUnix("rhapsod wrapper", () => {
  it("lists the services before the cli status", () => {
    const result = sandbox().run("status");
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^rhapsod\s+active$/m);
    expect(result.stdout).toMatch(/^bgutil-pot-provider\s+active$/m);
    expect(result.stdout).toContain("cli output");
    expect(result.calls).toContain("cli status\n");
  });

  it("passes --json through to the cli", () => {
    const result = sandbox("playing").run("status", "--json");
    expect(result.calls).toContain("cli status --json\n");
  });

  it("fails doctor when a service is down, after running the cli checks", () => {
    const result = sandbox("idle", "some").run("doctor");
    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      "FAIL  service bgutil-pot-provider: not running",
    );
    expect(result.stdout).toContain("ok    service rhapsod: active");
    expect(result.calls).toContain("cli doctor\n");
  });

  it("restarts an idle bot", () => {
    const result = sandbox("idle").run("restart");
    expect(result.code).toBe(0);
    expect(result.calls).toContain("systemctl restart rhapsod\n");
  });

  it("refuses to restart during playback", () => {
    const result = sandbox("playing").run("restart");
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("the player is playing");
    expect(result.calls).not.toContain("systemctl restart");
  });

  it("restarts during playback with --force, without asking the panel", () => {
    const result = sandbox("playing").run("restart", "--force");
    expect(result.code).toBe(0);
    expect(result.calls).toContain("systemctl restart rhapsod\n");
    expect(result.calls).not.toContain("cli status");
  });

  it("follows both journals and rejects a non-numeric line count", () => {
    const box = sandbox();
    expect(box.run("logs", "20").calls).toContain(
      "journalctl -u rhapsod -u rhapsod-ytdlp-daemon -n 20 -f\n",
    );
    expect(box.run("logs", "all").code).toBe(1);
  });

  it("backs up data and .env with the bot stopped, then starts it", () => {
    const box = sandbox();
    withReleases(box);
    const result = box.run("backup");
    expect(result.code, result.stderr).toBe(0);
    const file = /^Backup: (.+)$/m.exec(result.stdout)?.[1] ?? "";
    expect(file).toMatch(/rhapsod-\d{8}-\d{6}-[0-9a-f]{7}\.tar\.gz$/);
    const listing = spawnSync("tar", ["-tzf", file], { encoding: "utf8" });
    expect(listing.stdout).toContain("data/state.json");
    expect(listing.stdout).toContain(".env");
    expect(result.calls.indexOf("systemctl stop rhapsod")).toBeLessThan(
      result.calls.indexOf("systemctl start rhapsod"),
    );
  });

  it("refuses to back up during playback", () => {
    const box = sandbox("playing");
    withReleases(box);
    const result = box.run("backup");
    expect(result.code).toBe(1);
    expect(result.calls).not.toContain("systemctl stop");
  });

  it("updates to the latest release and records the version it replaced", () => {
    const box = sandbox();
    const { first, second } = withReleases(box);
    const result = box.run("update");
    expect(result.code, result.stderr).toBe(0);
    expect(result.calls).toContain(`--ref v4.1.0`);
    expect(git(box.app, "rev-parse", "HEAD")).toBe(second);
    expect(
      readFileSync(join(box.backups, "previous-version"), "utf8").trim(),
    ).toBe(first);
    expect(
      readFileSync(join(box.system, "usr", "local", "bin", "rhapsod"), "utf8"),
    ).toBe("new");
    expect(result.stdout).toContain("rhapsod rollback");
  });

  it("does nothing when the latest release is installed", () => {
    const box = sandbox();
    withReleases(box);
    git(box.app, "checkout", "-q", "--detach", "v4.1.0");
    const result = box.run("update");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Up to date: v4.1.0");
    expect(result.calls).not.toContain("deploy");
  });

  it("keeps the old version recorded when the update rolls back", () => {
    const box = sandbox();
    const { first } = withReleases(box);
    const result = box.runWith({ DEPLOY_FAILS: "1" }, "update", "--force");
    expect(result.code).toBe(1);
    expect(result.calls).toContain("--ref v4.1.0 --force");
    expect(result.stderr).toContain("update to v4.1.0 failed");
    expect(git(box.app, "rev-parse", "HEAD")).toBe(first);
    expect(
      readFileSync(join(box.system, "usr", "local", "bin", "rhapsod"), "utf8"),
    ).toBe("old");
  });

  it("rolls back to the version the last update replaced, and forward again", () => {
    const box = sandbox();
    const { first, second } = withReleases(box);
    expect(box.run("rollback").stderr).toContain("no previous version");
    box.run("update");
    expect(box.run("rollback").code).toBe(0);
    expect(git(box.app, "rev-parse", "HEAD")).toBe(first);
    box.run("rollback");
    expect(git(box.app, "rev-parse", "HEAD")).toBe(second);
  });

  it("uninstalls the services and the command, keeping the data", () => {
    const box = sandbox();
    withReleases(box);
    const result = box.run("uninstall", "--yes");
    expect(result.code, result.stderr).toBe(0);
    expect(result.calls).toContain("systemctl disable --now rhapsod\n");
    expect(readdirSync(join(box.system, "etc", "systemd", "system"))).toEqual(
      [],
    );
    expect(existsSync(join(box.system, "etc", "rhapsod"))).toBe(false);
    expect(existsSync(join(box.system, "usr", "local", "bin", "rhapsod"))).toBe(
      false,
    );
    expect(existsSync(join(box.app, "data", "state.json"))).toBe(true);
    expect(readdirSync(box.backups)).toHaveLength(1);
    expect(result.calls).not.toContain("userdel");
  });

  it("purges the user and the checkout, leaving a backup in /var/backups", () => {
    const box = sandbox();
    withReleases(box);
    const result = box.run("uninstall", "--purge", "--yes");
    expect(result.code, result.stderr).toBe(0);
    expect(existsSync(box.app)).toBe(false);
    expect(result.calls).toContain("userdel --remove rhapsod\n");
    expect(
      readdirSync(join(box.system, "var", "backups", "rhapsod")),
    ).toHaveLength(1);
  });

  it("asks before uninstalling when not told --yes", () => {
    const box = sandbox();
    const result = box.run("uninstall");
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("pass --yes");
    expect(result.calls).not.toContain("disable");
  });

  it("points at the installer when install.conf is missing", () => {
    const box = sandbox();
    rmSync(box.conf);
    const result = box.run("status");
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("was Rhapsod installed with install.sh?");
  });

  it("prints usage for an unknown command", () => {
    const result = sandbox().run("frobnicate");
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("rhapsod doctor");
  });
});
