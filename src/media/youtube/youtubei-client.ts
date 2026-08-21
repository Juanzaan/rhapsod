import { ClientType, Innertube, Platform, UniversalCache } from "youtubei.js";

import {
  HttpPoTokenProvider,
  type PoTokenProvider,
} from "./http-po-token-provider.js";

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
  readonly potProviderUrl?: string;
}

export interface YoutubeiClientHandle {
  readonly client: Innertube;
  readonly poTokens?: PoTokenProvider;
}

let pendingClient: Promise<YoutubeiClientHandle> | undefined;

export function createYoutubeiClient(
  options: YoutubeiClientOptions,
): Promise<YoutubeiClientHandle> {
  if (pendingClient !== undefined) return pendingClient;

  configurePlayerEvaluator();
  const poTokens =
    options.potProviderUrl === undefined
      ? undefined
      : new HttpPoTokenProvider(options.potProviderUrl);

  pendingClient = Innertube.create({
    cache: new UniversalCache(true, options.cacheDirectory),
    client_type:
      poTokens === undefined
        ? (options.clientType ?? ClientType.IOS)
        : ClientType.WEB,
    lang: "en",
    location: "AR",
    retrieve_player: true,
    ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  })
    .then((client) => ({
      client,
      ...(poTokens === undefined ? {} : { poTokens }),
    }))
    .catch((error: unknown) => {
      pendingClient = undefined;
      throw error;
    });

  return pendingClient;
}
