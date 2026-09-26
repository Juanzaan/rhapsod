// Smoke test: starts the bot in setup mode (panel only, no TeamSpeak) with a
// throwaway data directory, checks the panel answers, and stops it.
//
//   npm run build && npm run smoke        run dist/main.js
//   npm run smoke -- --source             run src/main.ts through tsx
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { get } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface SmokeOptions {
  /** Arguments after the node binary, e.g. ["dist/main.js"]. */
  readonly nodeArgs: readonly string[];
  readonly startTimeoutMs?: number;
  readonly stopTimeoutMs?: number;
}

export interface SmokeCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail?: string;
}

export interface SmokeResult {
  readonly ok: boolean;
  readonly checks: readonly SmokeCheck[];
  /** Last lines the bot wrote, for diagnosing a failure. */
  readonly output: string;
}

const ROOT = join(import.meta.dirname, "..");

export async function runSmoke(options: SmokeOptions): Promise<SmokeResult> {
  const directory = mkdtempSync(join(tmpdir(), "rhapsod-smoke-"));
  const envFile = join(directory, ".env");
  writeFileSync(envFile, "");
  const port = await freePort();
  const password = randomBytes(12).toString("hex");
  const auth = `Basic ${Buffer.from(`admin:${password}`).toString("base64")}`;
  const base = `http://127.0.0.1:${port}`;

  let output = "";
  const child = spawn(process.execPath, [...options.nodeArgs], {
    // A temporary cwd keeps dotenv from loading the developer's .env.
    cwd: directory,
    env: {
      PATH: process.env.PATH ?? "",
      RHAPSOD_DATA_DIR: join(directory, "data"),
      RHAPSOD_ENV_FILE: envFile,
      RHAPSOD_LOG_LEVEL: "info",
      RHAPSOD_PANEL_ENABLED: "true",
      RHAPSOD_PANEL_HOST: "127.0.0.1",
      RHAPSOD_PANEL_PASSWORD: password,
      RHAPSOD_PANEL_PORT: String(port),
      RHAPSOD_PANEL_USER: "admin",
      RHAPSOD_TS3_AUTO_CONNECT: "false",
      RHAPSOD_TS3_HOST: "127.0.0.1",
      ...(process.env.SYSTEMROOT === undefined
        ? {}
        : { SYSTEMROOT: process.env.SYSTEMROOT }),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const collect = (chunk: Buffer): void => {
    output = (output + chunk.toString("utf8")).slice(-8_000);
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  const exited = new Promise<number | null>((resolve) =>
    child.once("exit", (code) => resolve(code)),
  );

  const checks: SmokeCheck[] = [];
  const check = (name: string, ok: boolean, detail?: string): void => {
    checks.push({ name, ok, ...(detail === undefined ? {} : { detail }) });
  };
  const fetchPath = (path: string, withAuth = true): Promise<SmokeResponse> =>
    request(`${base}${path}`, withAuth ? { authorization: auth } : {});

  try {
    const started = await waitForPanel(
      () => fetchPath("/api/health"),
      exited,
      options.startTimeoutMs ?? 30_000,
    );
    check("panel starts", started.ok, started.detail);
    if (started.ok) {
      const anonymous = await fetchPath("/api/health", false);
      check(
        "rejects requests without credentials",
        anonymous.status === 401,
        `status ${anonymous.status}`,
      );

      const state = await fetchPath("/api/state");
      const body = parseJson(state.body) as
        { playerState?: unknown } | undefined;
      check(
        "serves /api/state",
        state.status === 200 && body?.playerState !== undefined,
        `status ${state.status}`,
      );

      const page = await fetchPath("/");
      check(
        "serves the dashboard",
        page.status === 200 && page.contentType.includes("text/html"),
        `status ${page.status}`,
      );

      // The browser scripts are read from dist/panel/scripts at runtime;
      // a build that forgot to copy them would fail here, not in a browser.
      const commands = await fetchPath("/commands");
      check(
        "inlines the panel scripts",
        commands.status === 200 && commands.body.includes("function filter("),
        `status ${commands.status}`,
      );
    }
  } finally {
    child.kill("SIGTERM");
    const code = await Promise.race([
      exited,
      delay(options.stopTimeoutMs ?? 10_000).then(() => "timeout" as const),
    ]);
    if (code === "timeout") child.kill("SIGKILL");
    // Windows has no SIGTERM handler to run: the process is killed outright.
    if (process.platform !== "win32") {
      check(
        "stops on SIGTERM",
        code === 0,
        code === "timeout" ? "still running" : `exit code ${code}`,
      );
    }
    rmSync(directory, { force: true, maxRetries: 3, recursive: true });
  }
  return { checks, ok: checks.every((entry) => entry.ok), output };
}

async function waitForPanel(
  probe: () => Promise<SmokeResponse>,
  exited: Promise<number | null>,
  timeoutMs: number,
): Promise<{ ok: boolean; detail?: string }> {
  let gone: number | null | undefined;
  void exited.then((code) => (gone = code));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (gone !== undefined) return { detail: `exited with ${gone}`, ok: false };
    try {
      const response = await probe();
      if (response.status === 200) return { ok: true };
    } catch {
      // Not listening yet.
    }
    await delay(250);
  }
  return { detail: `no answer within ${timeoutMs} ms`, ok: false };
}

interface SmokeResponse {
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
}

// node:http with one connection per request instead of fetch: undici's
// pooled keep-alive sockets were still open when the bot exited, and on
// Node 24 undici then failed an internal assertion (`assert(!this.paused)`)
// as an uncaught exception in the test worker.
function request(
  url: string,
  headers: Record<string, string>,
): Promise<SmokeResponse> {
  return new Promise((resolve, reject) => {
    const req = get(url, { agent: false, headers, timeout: 5_000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () =>
        resolve({
          body: Buffer.concat(chunks).toString("utf8"),
          contentType: res.headers["content-type"] ?? "",
          status: res.statusCode ?? 0,
        }),
      );
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("request timed out")));
    req.on("error", reject);
  });
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatSmoke(result: SmokeResult): string {
  const lines = result.checks.map(
    (entry) =>
      `${entry.ok ? "ok  " : "FAIL"} ${entry.name}${
        entry.ok || entry.detail === undefined ? "" : ` (${entry.detail})`
      }`,
  );
  if (!result.ok) lines.push("", "Bot output:", result.output.trimEnd());
  return lines.join("\n");
}

if (import.meta.filename === process.argv[1]) {
  const source = process.argv.includes("--source");
  const result = await runSmoke({
    nodeArgs: source
      ? ["--import", import.meta.resolve("tsx"), join(ROOT, "src", "main.ts")]
      : [join(ROOT, "dist", "main.js")],
  });
  process.stdout.write(`${formatSmoke(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}
