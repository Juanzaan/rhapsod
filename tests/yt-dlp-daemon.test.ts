import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// The daemon is Python, so its behavior is tested with unittest; this keeps
// that suite inside `npm test` and CI. Python is optional on developer
// machines (the Windows Store alias exits non-zero), so the suite skips then.
function findPython(): string | undefined {
  for (const executable of ["python3", "python"]) {
    const probe = spawnSync(executable, ["--version"], { encoding: "utf8" });
    if (probe.status === 0 && /^Python 3\./.test(probe.stdout + probe.stderr)) {
      return executable;
    }
  }
  return undefined;
}

const python = findPython();

describe.skipIf(python === undefined)("yt-dlp daemon", () => {
  it("passes its Python unit tests", () => {
    const result = spawnSync(
      python!,
      [join(import.meta.dirname, "python", "test_yt_dlp_daemon.py")],
      { encoding: "utf8", timeout: 60_000 },
    );
    expect(result.status, result.stderr).toBe(0);
  });
});
