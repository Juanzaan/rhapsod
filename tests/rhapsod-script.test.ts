import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
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

  const run = (...args: string[]) => {
    const result = spawnSync("bash", [script, ...args], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        RHAPSOD_INSTALL_CONF: conf,
        RHAPSOD_SYSTEMCTL: systemctl,
        RHAPSOD_JOURNALCTL: journalctl,
        RHAPSOD_AS_USER: asUser,
        RHAPSOD_NO_SUDO: "1",
      },
    });
    return {
      code: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      calls: readFileSync(calls, "utf8"),
    };
  };
  return { run, conf };
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
