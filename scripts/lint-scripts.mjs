import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const scriptDir = join(import.meta.dirname);
const failures = [];

function checkMjs(file) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    console.log(`ok   ${file}`);
  } catch (error) {
    failures.push(file);
    console.error(`FAIL ${file}`);
    if (error.stderr) process.stderr.write(String(error.stderr));
  }
}

function checkPython(file) {
  for (const executable of ["python3", "python"]) {
    try {
      execFileSync(
        executable,
        [
          "-c",
          "import ast, pathlib, sys; ast.parse(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))",
          file,
        ],
        { stdio: "pipe" },
      );
      console.log(`ok   ${file}`);
      return;
    } catch (error) {
      const stderr = String(error.stderr ?? "");
      const unavailable =
        error.code === "ENOENT" ||
        /Microsoft Store|not recognized/i.test(stderr);
      if (unavailable) {
        continue;
      }
      failures.push(file);
      console.error(`FAIL ${file}`);
      if (error.stderr) process.stderr.write(stderr);
      return;
    }
  }
  console.log(`skip ${file} (Python not available)`);
}

function checkBash(file) {
  // On Windows "bash" may be WSL, which cannot read a Windows path.
  if (process.platform === "win32") {
    console.log(`skip ${file} (Windows)`);
    return;
  }
  try {
    execFileSync("bash", ["-n", file], { stdio: "pipe" });
    console.log(`ok   ${file}`);
  } catch (error) {
    if (error.code === "ENOENT") {
      console.log(`skip ${file} (bash not available)`);
      return;
    }
    failures.push(file);
    console.error(`FAIL ${file}`);
    if (error.stderr) process.stderr.write(String(error.stderr));
  }
}

for (const entry of readdirSync(scriptDir)) {
  const file = join(scriptDir, entry);
  if (entry.endsWith(".mjs")) checkMjs(file);
  if (entry.endsWith(".py")) checkPython(file);
  if (entry.endsWith(".sh")) checkBash(file);
}

for (const unit of [
  "rhapsod.service",
  "rhapsod@.service",
  "rhapsod-ytdlp-daemon.service",
  "bgutil-pot-provider.service",
]) {
  const content = readFileSync(
    join(scriptDir, "..", "deploy", "systemd", unit),
    "utf8",
  );
  if (!content.includes("[Unit]") || !content.includes("[Service]")) {
    failures.push(unit);
    console.error(`FAIL ${unit}: missing [Unit] or [Service] section`);
  } else {
    console.log(`ok   ${unit}`);
  }
}

if (failures.length > 0) {
  console.error(
    `\n${failures.length} script(s) failed: ${failures.join(", ")}`,
  );
  process.exit(1);
}
console.log("\nAll scripts valid.");
