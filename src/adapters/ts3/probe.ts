import { Client, generateIdentity } from "@honeybbq/teamspeak-client";

export interface Ts3ProbeResult {
  readonly ok: boolean;
  readonly serverName?: string;
  readonly error?: string;
}

const PROBE_TIMEOUT_MS = 10_000;
const PROBE_NICKNAME = "RhapsodProbe";
const PROBE_IDENTITY_LEVEL = 8;

function unescapeTs3Param(value: string): string {
  return value.replace(/\\(\\|s|p|\/)/g, (_match, code: string) => {
    if (code === "s") return " ";
    if (code === "p") return "|";
    return code;
  });
}

export function parseProbeServerName(
  rows: readonly Record<string, string>[],
): string | undefined {
  const raw = rows[0]?.virtualserver_name;
  if (raw === undefined || raw.length === 0) return undefined;
  const name = unescapeTs3Param(raw);
  return name === "(no disponible)" ? undefined : name;
}

function sanitizeProbeError(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Error de conexión";
  const singleLine = raw.replace(/\s+/g, " ").trim();
  const message =
    singleLine.length > 160 ? `${singleLine.slice(0, 159)}…` : singleLine;
  return message.length > 0 ? message : "Error de conexión";
}

function validateTarget(host: string, port: number): string | undefined {
  if (host.trim().length === 0) return "Falta el host del servidor.";
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    return "Puerto inválido (1-65535).";
  }
  return undefined;
}

/**
 * Probes a TeamSpeak 3 server with a throwaway identity: connects, reads
 * the virtual server name, and disconnects. Used by the setup wizard's
 * "test connection" step. Never touches the bot's own connection.
 */
export async function probeTs3Server(
  host: string,
  port: number,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<Ts3ProbeResult> {
  const invalid = validateTarget(host, port);
  if (invalid !== undefined) return { ok: false, error: invalid };
  const client = new Client(
    generateIdentity(PROBE_IDENTITY_LEVEL),
    `${host.trim()}:${port}`,
    PROBE_NICKNAME,
    {},
  );
  try {
    await client.connect();
    await client.waitConnected(AbortSignal.timeout(timeoutMs));
    try {
      const rows = await client.execCommandWithResponse("serverinfo");
      const serverName = parseProbeServerName(rows);
      return serverName === undefined ? { ok: true } : { ok: true, serverName };
    } catch {
      // Connected and speaking TS3, but serverinfo failed: still reachable.
      return { ok: true };
    }
  } catch (error) {
    return { ok: false, error: sanitizeProbeError(error) };
  } finally {
    await client.disconnect().catch(() => undefined);
  }
}
