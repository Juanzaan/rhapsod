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
  try {
    execFileSync("python3", ["-m", "py_compile", file], { stdio: "pipe" });
    console.log(`ok   ${file}`);
  } catch (error) {
    const stderr = String(error.stderr ?? "");
    const unavailable =
      error.code === "ENOENT" || /Microsoft Store|not recognized/i.test(stderr);
    if (unavailable) {
      console.log(`skip ${file} (python3 not available)`);
      return;
    }
    failures.push(file);
    console.error(`FAIL ${file}`);
    if (error.stderr) process.stderr.write(stderr);
  }
}

for (const entry of readdirSync(scriptDir)) {
  const file = join(scriptDir, entry);
  if (entry.endsWith(".mjs")) checkMjs(file);
  if (entry.endsWith(".py")) checkPython(file);
}

for (const unit of ["rhapsod.service", "rhapsod-ytdlp-daemon.service"]) {
  const content = readFileSync(join(scriptDir, "..", unit), "utf8");
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
