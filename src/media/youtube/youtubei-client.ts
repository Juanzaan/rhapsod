import { ClientType, Innertube, Platform, UniversalCache } from "youtubei.js";

import {
  HttpPoTokenProvider,
  type PoTokenProvider,
} from "./http-po-token-provider.js";
import {
  YoutubeOAuth,
  type YoutubeOAuthLogger,
} from "../../lib/youtube-oauth.js";

let evaluatorConfigured = false;

function configurePlayerEvaluator(): void {
  if (evaluatorConfigured) return;
  evaluatorConfigured = true;
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
  readonly youtubeClientId?: string;
  readonly youtubeClientSecret?: string;
  readonly youtubeRefreshToken?: string;
  readonly logger?: YoutubeOAuthLogger;
}

export interface YoutubeiClientHandle {
  readonly clients: readonly Innertube[];
  readonly poTokens?: PoTokenProvider;
  readonly oauth?: YoutubeOAuth;
}

let pendingClient: Promise<YoutubeiClientHandle> | undefined;

const ROTATION_CLIENT_TYPES = [
  ClientType.IOS,
  ClientType.ANDROID,
  ClientType.WEB,
] as const;

async function createRotatingClients(
  options: YoutubeiClientOptions,
  cacheDirectory: string,
): Promise<readonly Innertube[]> {
  const baseOpts = {
    cache: new UniversalCache(true, cacheDirectory),
    lang: "en",
    location: "AR",
    retrieve_player: true,
    ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  };

  const clients: Innertube[] = [];
  for (const clientType of ROTATION_CLIENT_TYPES) {
    clients.push(
      await Innertube.create({ ...baseOpts, client_type: clientType }),
    );
  }
  return clients;
}

export function createYoutubeiClient(
  options: YoutubeiClientOptions,
): Promise<YoutubeiClientHandle> {
  if (pendingClient !== undefined) return pendingClient;

  configurePlayerEvaluator();
  const poTokens =
    options.potProviderUrl === undefined
      ? undefined
      : new HttpPoTokenProvider(options.potProviderUrl);

  const oauth =
    options.youtubeClientId !== undefined &&
    options.youtubeClientSecret !== undefined &&
    options.youtubeRefreshToken !== undefined
      ? new YoutubeOAuth(
          {
            clientId: options.youtubeClientId,
            clientSecret: options.youtubeClientSecret,
            refreshToken: options.youtubeRefreshToken,
          },
          undefined,
          options.logger,
        )
      : undefined;

  const logger = options.logger;

  pendingClient = createRotatingClients(options, options.cacheDirectory)
    .then((clients) => {
      logger?.info(
        { count: clients.length },
        "youtubei.js: rotating client pool created",
      );
      return {
        clients,
        ...(poTokens === undefined ? {} : { poTokens }),
        ...(oauth === undefined ? {} : { oauth }),
      };
    })
    .catch((error: unknown) => {
      pendingClient = undefined;
      throw error;
    });

  return pendingClient;
}
