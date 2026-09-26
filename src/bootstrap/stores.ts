import { join } from "node:path";

import type { Logger } from "pino";

import { AudioUrlCache } from "../application/audio-url-cache.js";
import { ListeningHistory } from "../application/listening-history.js";
import { SongLibrary } from "../application/song-library.js";
import { UserPreferences } from "../application/user-preferences.js";
import { UserTelemetry } from "../application/user-telemetry.js";
import type { MetricsCollector } from "../observability/metrics.js";

/** The JSON stores under the data directory that outlive a restart. */
export interface Stores {
  readonly telemetry: UserTelemetry;
  readonly preferences: UserPreferences;
  readonly listeningHistory: ListeningHistory;
  readonly songLibrary: SongLibrary;
  readonly audioUrlCache: AudioUrlCache;
}

export function openStores(options: {
  readonly dataDir: string;
  readonly logger: Logger;
  readonly metrics: MetricsCollector;
}): Stores {
  const { dataDir, logger, metrics } = options;
  const telemetry = new UserTelemetry(
    join(dataDir, "user-telemetry.json"),
    logger,
  );
  telemetry.load();
  const listeningHistory = new ListeningHistory(
    join(dataDir, "listening-history.json"),
    logger,
  );
  const songLibrary = new SongLibrary(
    join(dataDir, "song-library.json"),
    logger,
  );
  // At startup, not inside the first onPlaybackStarted: a large history
  // parsed there delayed the first track's audio.
  listeningHistory.load();
  songLibrary.load();
  return {
    audioUrlCache: AudioUrlCache.load(
      join(dataDir, "audio-url-cache.json"),
      logger,
      {
        onHit: () => metrics.increment("cacheHits"),
        onMiss: () => metrics.increment("cacheMisses"),
      },
    ),
    listeningHistory,
    preferences: new UserPreferences(join(dataDir, "user-preferences.json")),
    songLibrary,
    telemetry,
  };
}

/**
 * Writes every pending change. One failing store must not keep the others
 * from saving, so each failure is swallowed on its own.
 */
export async function flushStores(
  stores: Stores,
  ...extra: readonly (() => Promise<void>)[]
): Promise<void> {
  await Promise.all(
    [
      () => stores.audioUrlCache.flush(),
      () => stores.telemetry.save(),
      () => stores.preferences.flush(),
      () => stores.listeningHistory.flush(),
      () => stores.songLibrary.flush(),
      ...extra,
    ].map((flush) => flush().catch(() => undefined)),
  );
}
