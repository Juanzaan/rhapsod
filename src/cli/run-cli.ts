import { validateConfig, loadConfig, type AppConfig } from "../config.js";
import type { PanelHealth } from "../panel/panel-server.js";

export interface CliIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

export interface CliDeps extends CliIo {
  /** process.env over the .env file, the way the bot sees it at startup. */
  readonly env: NodeJS.ProcessEnv;
  readonly envFilePath: string;
  readonly version: string;
  readonly nodeVersion: string;
  readonly fetch: (
    url: string,
    init: {
      readonly headers: Record<string, string>;
      readonly signal: AbortSignal;
    },
  ) => Promise<Response>;
  /** First line of `binary ...args`; throws when it cannot run. */
  readonly firstLine: (
    binary: string,
    args: readonly string[],
  ) => Promise<string>;
  readonly canConnect: (host: string, port: number) => Promise<boolean>;
  readonly freeBytes: (path: string) => Promise<number>;
  /** undefined when the host cannot tell (no timedatectl). */
  readonly clockSynced: () => Promise<boolean | undefined>;
  readonly readText: (path: string) => Promise<string | undefined>;
  readonly saveEnv: (
    path: string,
    values: Record<string, string>,
  ) => Promise<void>;
  readonly loadEnv: (path: string) => Record<string, string>;
  readonly generatePassword: () => string;
  readonly defaultFfmpeg: string;
}

const USAGE = `Usage: node dist/cli.js <command>

  status [--json]  what the bot is doing, read from the local panel
  doctor           checks the install and says what to fix
  password         sets a new random panel password in the env file
  version          prints the installed version`;

const MIN_NODE: readonly [number, number] = [22, 19];
const LOW_DISK_BYTES = 1024 ** 3;
const FULL_DISK_BYTES = 200 * 1024 ** 2;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export async function runCli(
  args: readonly string[],
  deps: CliDeps,
): Promise<number> {
  const [command, ...rest] = args;
  switch (command) {
    case "version":
      deps.out(deps.version);
      return 0;
    case "status":
      return status(deps, rest.includes("--json"));
    case "doctor":
      return doctor(deps);
    case "password":
      return password(deps);
    case undefined:
    case "help":
    case "--help":
    case "-h":
      deps.out(USAGE);
      return command === undefined ? 2 : 0;
    default:
      deps.err(`Unknown command: ${command}\n\n${USAGE}`);
      return 2;
  }
}

function readConfig(deps: CliDeps): AppConfig | undefined {
  const issues = validateConfig(deps.env);
  if (issues.length === 0) return loadConfig(deps.env);
  deps.err(`${deps.envFilePath} has values the bot rejects at startup:`);
  for (const issue of issues) deps.err(`  ${issue.key}: ${issue.message}`);
  return undefined;
}

function panelBaseUrl(config: AppConfig): string {
  const host = config.RHAPSOD_PANEL_HOST;
  const reachable = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  const bracketed = reachable.includes(":") ? `[${reachable}]` : reachable;
  return `http://${bracketed}:${config.RHAPSOD_PANEL_PORT}`;
}

type PanelAnswer =
  | { readonly kind: "ok"; readonly status: PanelHealth }
  | { readonly kind: "disabled" }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "down"; readonly detail: string };

// /api/health is the same payload the panel polls; a 503 there still
// carries the status body (the bot is reconnecting to TeamSpeak).
async function readPanel(
  deps: CliDeps,
  config: AppConfig,
): Promise<PanelAnswer> {
  if (!config.RHAPSOD_PANEL_ENABLED) return { kind: "disabled" };
  const credentials = Buffer.from(
    `${config.RHAPSOD_PANEL_USER}:${config.RHAPSOD_PANEL_PASSWORD}`,
  ).toString("base64");
  try {
    const response = await deps.fetch(`${panelBaseUrl(config)}/api/health`, {
      headers: { Authorization: `Basic ${credentials}` },
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 401) return { kind: "unauthorized" };
    if (response.status !== 200 && response.status !== 503) {
      return { kind: "down", detail: `HTTP ${response.status}` };
    }
    return { kind: "ok", status: (await response.json()) as PanelHealth };
  } catch (error: unknown) {
    return {
      kind: "down",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

function noticesLine(s: PanelHealth): string {
  const count = s.openNotices ?? 0;
  return `${s.verdict ?? "ok"}, ${String(count)} open ${count === 1 ? "notice" : "notices"}; list them with !avisos in TeamSpeak or on the panel console`;
}

function formatUptime(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

function tunnelLine(config: AppConfig): string {
  const port = config.RHAPSOD_PANEL_PORT;
  return `ssh -N -L ${port}:127.0.0.1:${port} <user>@<this-host>, then open http://127.0.0.1:${port}/`;
}

async function pendingClaimCode(
  deps: CliDeps,
  config: AppConfig,
): Promise<string | undefined> {
  const code = await deps.readText(
    `${config.RHAPSOD_DATA_DIR}/admin-claim-code`,
  );
  const trimmed = code?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

async function status(deps: CliDeps, json: boolean): Promise<number> {
  const config = readConfig(deps);
  if (config === undefined) return 1;
  const panel = await readPanel(deps, config);
  const claimCode = await pendingClaimCode(deps, config);
  if (json) {
    deps.out(
      JSON.stringify({
        version: deps.version,
        panel: panel.kind,
        ...(panel.kind === "ok"
          ? {
              playerState: panel.status.playerState ?? "idle",
              connected: panel.status.connected,
              reconnecting: panel.status.reconnecting === true,
              ...(panel.status.verdict === undefined
                ? {}
                : {
                    verdict: panel.status.verdict,
                    openNotices: panel.status.openNotices ?? 0,
                  }),
            }
          : {}),
        adminClaimPending: claimCode !== undefined,
      }),
    );
    return panel.kind === "ok" ? 0 : 1;
  }

  deps.out(`Rhapsod ${deps.version}`);
  switch (panel.kind) {
    case "ok": {
      const s = panel.status;
      const state = s.playerState ?? "idle";
      const track =
        s.currentTitle === undefined
          ? ""
          : ` "${s.currentArtist === undefined ? "" : `${s.currentArtist} - `}${s.currentTitle}"`;
      deps.out(`Player:     ${state}${track}, ${s.queueLength} queued`);
      deps.out(
        `TeamSpeak:  ${s.reconnecting === true ? "reconnecting" : s.connected ? "connected" : "not connected"}`,
      );
      if (s.youtubeAuthHealthy === false) {
        deps.out("YouTube:    failing; run the doctor for the fix");
      }
      if (s.verdict !== undefined && s.verdict !== "ok") {
        deps.out(`Notices:    ${noticesLine(s)}`);
      }
      if (s.uptimeMs !== undefined) {
        deps.out(`Uptime:     ${formatUptime(s.uptimeMs)}`);
      }
      break;
    }
    case "disabled":
      deps.out("Player:     unknown (panel disabled, RHAPSOD_PANEL_ENABLED)");
      break;
    case "unauthorized":
      deps.out(
        "Player:     unknown (the panel refused the password in the env file; was it changed without a restart?)",
      );
      break;
    case "down":
      deps.out(
        `Player:     not answering on ${panelBaseUrl(config)} (${panel.detail})`,
      );
      break;
  }
  if (claimCode !== undefined) {
    deps.out(`Admin:      none yet; send  !claim ${claimCode}  in TeamSpeak`);
  }
  if (config.RHAPSOD_PANEL_ENABLED) {
    deps.out(`Panel:      ${tunnelLine(config)}`);
  }
  return panel.kind === "ok" ? 0 : 1;
}

type Level = "ok" | "warn" | "fail";

interface Finding {
  readonly level: Level;
  readonly name: string;
  readonly detail: string;
}

function atLeast(version: string, minimum: readonly [number, number]): boolean {
  const [major = 0, minor = 0] = version
    .replace(/^v/, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10));
  return major > minimum[0] || (major === minimum[0] && minor >= minimum[1]);
}

function hostPort(url: string): { host: string; port: number } | undefined {
  try {
    const parsed = new URL(url);
    const port =
      parsed.port === ""
        ? parsed.protocol === "https:"
          ? 443
          : 80
        : Number(parsed.port);
    return { host: parsed.hostname.replace(/^\[|\]$/g, ""), port };
  } catch {
    return undefined;
  }
}

function potUrl(extractorArgs: string | undefined): string | undefined {
  return /po_token_uri=([^;\s]+)/.exec(extractorArgs ?? "")?.[1];
}

async function binaryFinding(
  deps: CliDeps,
  name: string,
  binary: string,
  args: readonly string[],
): Promise<Finding> {
  try {
    const line = await deps.firstLine(binary, args);
    return { level: "ok", name, detail: line.split(" ").slice(0, 3).join(" ") };
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    return { level: "fail", name, detail: `${binary} did not run: ${reason}` };
  }
}

async function portFinding(
  deps: CliDeps,
  name: string,
  url: string,
  unit: string,
): Promise<Finding> {
  const target = hostPort(url);
  if (target === undefined) {
    return { level: "fail", name, detail: `unreadable URL ${url}` };
  }
  return (await deps.canConnect(target.host, target.port))
    ? {
        level: "ok",
        name,
        detail: `answering on ${target.host}:${target.port}`,
      }
    : {
        level: "fail",
        name,
        detail: `nothing on ${target.host}:${target.port}; check the ${unit} service`,
      };
}

async function doctor(deps: CliDeps): Promise<number> {
  const findings: Finding[] = [];
  const add = (finding: Finding): void => {
    findings.push(finding);
    const mark = { ok: "ok  ", warn: "WARN", fail: "FAIL" }[finding.level];
    deps.out(`${mark}  ${finding.name}: ${finding.detail}`);
  };

  add(
    atLeast(deps.nodeVersion, MIN_NODE)
      ? { level: "ok", name: "Node.js", detail: deps.nodeVersion }
      : {
          level: "fail",
          name: "Node.js",
          detail: `${deps.nodeVersion}; Rhapsod needs ${MIN_NODE.join(".")} or newer`,
        },
  );

  const config = readConfig(deps);
  if (config === undefined) {
    add({ level: "fail", name: "Config", detail: deps.envFilePath });
    return 1;
  }
  add({ level: "ok", name: "Config", detail: deps.envFilePath });

  if (!config.RHAPSOD_PANEL_ENABLED) {
    add({ level: "ok", name: "Panel bind", detail: "panel disabled" });
  } else if (LOOPBACK_HOSTS.has(config.RHAPSOD_PANEL_HOST)) {
    add({
      level: "ok",
      name: "Panel bind",
      detail: `${config.RHAPSOD_PANEL_HOST}:${config.RHAPSOD_PANEL_PORT}`,
    });
  } else {
    add({
      level: "fail",
      name: "Panel bind",
      detail: `RHAPSOD_PANEL_HOST=${config.RHAPSOD_PANEL_HOST} exposes the panel; set it to 127.0.0.1 and use an SSH tunnel`,
    });
  }

  add(
    await binaryFinding(
      deps,
      "FFmpeg",
      config.RHAPSOD_FFMPEG_PATH ?? deps.defaultFfmpeg,
      ["-version"],
    ),
  );
  add(
    await binaryFinding(deps, "yt-dlp", config.RHAPSOD_YTDLP_PATH, [
      "--version",
    ]),
  );

  if (config.RHAPSOD_YTDLP_DAEMON_URL !== undefined) {
    add(
      await portFinding(
        deps,
        "yt-dlp daemon",
        config.RHAPSOD_YTDLP_DAEMON_URL,
        "rhapsod-ytdlp-daemon",
      ),
    );
  }
  const pot = potUrl(config.RHAPSOD_YTDLP_EXTRACTOR_ARGS);
  if (pot !== undefined) {
    add(await portFinding(deps, "POT provider", pot, "bgutil-pot-provider"));
  }

  const panel = await readPanel(deps, config);
  if (panel.kind === "ok") {
    const s = panel.status;
    add(
      s.connected && s.reconnecting !== true
        ? { level: "ok", name: "TeamSpeak", detail: "connected" }
        : {
            level: "warn",
            name: "TeamSpeak",
            detail: s.reconnecting === true ? "reconnecting" : "not connected",
          },
    );
    if (s.youtubeAuthHealthy === false) {
      add({
        level: "warn",
        name: "YouTube",
        detail:
          config.RHAPSOD_WARP_PROXY === undefined
            ? "failing; on a cloud VPS YouTube often blocks the IP: rerun the installer with RHAPSOD_WITH_WARP=1, or load account cookies in the panel's YouTube step"
            : "failing even through WARP; load account cookies in the panel's YouTube step",
      });
    }
    if (s.verdict !== undefined && s.verdict !== "ok") {
      add({
        level: s.verdict === "unhealthy" ? "fail" : "warn",
        name: "Notices",
        detail: noticesLine(s),
      });
    }
    if (s.ytdlpDaemon?.state === "failing") {
      add({
        level: "warn",
        name: "yt-dlp daemon",
        detail: `the bot falls back to spawning yt-dlp (${s.ytdlpDaemon.lastFailureReason ?? "failing"})`,
      });
    }
  } else if (panel.kind === "unauthorized") {
    add({
      level: "warn",
      name: "Bot",
      detail:
        "the panel refused the password in the env file; restart the bot to apply it",
    });
  } else if (panel.kind === "down") {
    add({
      level: "fail",
      name: "Bot",
      detail: `panel not answering on ${panelBaseUrl(config)}; is the bot running?`,
    });
  }

  try {
    const free = await deps.freeBytes(config.RHAPSOD_DATA_DIR);
    const gib = (free / 1024 ** 3).toFixed(1);
    add(
      free < FULL_DISK_BYTES
        ? { level: "fail", name: "Disk", detail: `${gib} GiB free` }
        : free < LOW_DISK_BYTES
          ? { level: "warn", name: "Disk", detail: `${gib} GiB free` }
          : { level: "ok", name: "Disk", detail: `${gib} GiB free` },
    );
  } catch {
    add({
      level: "warn",
      name: "Disk",
      detail: `cannot read ${config.RHAPSOD_DATA_DIR}`,
    });
  }

  // TeamSpeak and YouTube both reject a client whose clock is far off.
  const synced = await deps.clockSynced();
  if (synced !== undefined) {
    add(
      synced
        ? { level: "ok", name: "Clock", detail: "synchronized" }
        : {
            level: "warn",
            name: "Clock",
            detail: "not synchronized; enable NTP (timedatectl set-ntp true)",
          },
    );
  }

  const failed = findings.filter((f) => f.level === "fail").length;
  const warned = findings.filter((f) => f.level === "warn").length;
  deps.out("");
  deps.out(
    failed === 0 && warned === 0
      ? "All checks passed."
      : `${failed} failed, ${warned} warnings.`,
  );
  return failed === 0 ? 0 : 1;
}

async function password(deps: CliDeps): Promise<number> {
  const values = deps.loadEnv(deps.envFilePath);
  const next = deps.generatePassword();
  await deps.saveEnv(deps.envFilePath, {
    ...values,
    RHAPSOD_PANEL_PASSWORD: next,
  });
  deps.out(`New panel password: ${next}`);
  deps.out(
    "It applies after the bot restarts; restart it when nothing is playing.",
  );
  return 0;
}
