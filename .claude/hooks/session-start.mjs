#!/usr/bin/env node
// Cloud sessions start from a fresh clone with no node_modules. Local
// checkouts are left alone: the owner manages those.
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

if (process.env.CLAUDE_CODE_REMOTE !== "true") process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const lock = join(root, "package-lock.json");
const marker = join(root, "node_modules", ".package-lock.json");
const fresh =
  existsSync(marker) &&
  existsSync(lock) &&
  statSync(marker).mtimeMs >= statSync(lock).mtimeMs;

if (!fresh) {
  try {
    execFileSync("npm", ["ci", "--no-audit", "--no-fund"], {
      cwd: root,
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch (error) {
    process.stdout.write(
      `npm ci failed at session start; run it by hand.\n${String(error.stderr ?? error).slice(-2000)}\n`,
    );
    process.exit(0);
  }
}
process.stdout.write(
  "Dependencies installed (npm ci). `npm run check` is ready.\n",
);
