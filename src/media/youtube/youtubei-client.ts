import { ClientType, Innertube, Platform, UniversalCache } from "youtubei.js";

let evaluatorConfigured = false;

function configurePlayerEvaluator(): void {
  if (evaluatorConfigured) return;
  evaluatorConfigured = true;
  // YouTube.js decrypts streaming URLs by executing YouTube's player JS. This
  // is the equivalent of yt-dlp's JS runtime; it only runs code fetched from
  // youtube.com to compute the deciphering steps.
  /* eslint-disable @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
  Platform.shim.eval = ({ output }: { output: string }) =>
    new Function(output)();
  /* eslint-enable @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
}

export interface YoutubeiClientOptions {
  readonly cacheDirectory: string;
  readonly cookie?: string;
  readonly fetch?: typeof fetch;
  readonly clientType?: ClientType;
}

let pendingClient: Promise<Innertube> | undefined;

export function createYoutubeiClient(
  options: YoutubeiClientOptions,
): Promise<Innertube> {
  if (pendingClient !== undefined) return pendingClient;

  configurePlayerEvaluator();

  pendingClient = Innertube.create({
    cache: new UniversalCache(true, options.cacheDirectory),
    client_type: options.clientType ?? ClientType.IOS,
    lang: "en",
    location: "AR",
    retrieve_player: true,
    ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  }).catch((error: unknown) => {
    pendingClient = undefined;
    throw error;
  });

  return pendingClient;
}
