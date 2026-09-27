import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const script = resolve(import.meta.dirname, "../install.sh");

// Only the pure functions run here: the install itself needs root, systemd
// and network downloads. Skipped on Windows, like the deploy script tests.
const describeUnix = describe.skipIf(process.platform === "win32");

// The script runs the named function itself, so no shell command string is
// built here and no test value is parsed as shell code.
function run(
  args: readonly string[],
  env: Record<string, string> = {},
): { code: number | null; stdout: string } {
  const result = spawnSync("bash", [script, ...args], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      RHAPSOD_INSTALL_FUNCTIONS_ONLY: "1",
      // Never prompt, even when the suite runs from a terminal.
      RHAPSOD_INSTALL_TTY: "/nonexistent/tty",
      ...env,
    },
  });
  return { code: result.status, stdout: result.stdout };
}

describeUnix("install.sh TeamSpeak answer", () => {
  it("turns a bare address into a connecting .env", () => {
    expect(run(["ts3_env_lines", "ts.example.com"]).stdout).toBe(
      "RHAPSOD_TS3_HOST=ts.example.com\nRHAPSOD_TS3_AUTO_CONNECT=true\n",
    );
  });

  it("splits a port and keeps the server password", () => {
    expect(run(["ts3_env_lines", "203.0.113.7:10011", "s3cret"]).stdout).toBe(
      "RHAPSOD_TS3_HOST=203.0.113.7\nRHAPSOD_TS3_PORT=10011\nRHAPSOD_TS3_PASSWORD=s3cret\nRHAPSOD_TS3_AUTO_CONNECT=true\n",
    );
  });

  it("reads bracketed and bare IPv6 addresses", () => {
    expect(run(["ts3_env_lines", "[2001:db8::1]:9988"]).stdout).toContain(
      "RHAPSOD_TS3_HOST=2001:db8::1\nRHAPSOD_TS3_PORT=9988\n",
    );
    expect(run(["ts3_env_lines", "2001:db8::1"]).stdout).toContain(
      "RHAPSOD_TS3_HOST=2001:db8::1\n",
    );
  });

  it.each([
    ["an out-of-range port", ["ts.example.com:70000"]],
    ["a space", ["ts.example.com x"]],
    ["a # that dotenv would cut", ["ts.example.com", "pa#ss"]],
    ["a quote dotenv would strip", ["ts.example.com", "it's"]],
    ["an empty host", [":9987"]],
  ])("rejects %s", (_label, args) => {
    const result = run(["ts3_env_lines", ...args]);
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe("");
  });

  it("uses RHAPSOD_TS3_HOST without asking", () => {
    expect(
      run(["ask_ts3"], {
        RHAPSOD_TS3_HOST: "ts.example.com:9987",
        RHAPSOD_TS3_PASSWORD: "pw",
      }).stdout,
    ).toBe(
      "RHAPSOD_TS3_HOST=ts.example.com\nRHAPSOD_TS3_PORT=9987\nRHAPSOD_TS3_PASSWORD=pw\nRHAPSOD_TS3_AUTO_CONNECT=true\n",
    );
  });

  it("fails on an unusable RHAPSOD_TS3_HOST instead of writing it", () => {
    expect(run(["ask_ts3"], { RHAPSOD_TS3_HOST: "bad host" }).code).not.toBe(0);
  });

  it("stays panel-only without a terminal or RHAPSOD_TS3_HOST", () => {
    expect(run(["ask_ts3"])).toEqual({ code: 0, stdout: "" });
  });
});
