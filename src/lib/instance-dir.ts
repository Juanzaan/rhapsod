import { join } from "node:path";

// Multi-instance base: every persistent path (state, playlists, telemetry,
// favorites, caches, identity, logs) hangs off one directory. A named
// instance nests it under dataDir/instances/<id> so several bot processes
// share one host without touching each other's files. Unset keeps the
// historical single-instance layout untouched.
export function resolveInstanceDir(
  dataDir: string,
  instanceId?: string,
): string {
  if (instanceId === undefined) return dataDir;
  return join(dataDir, "instances", instanceId);
}
