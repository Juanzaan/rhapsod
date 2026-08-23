import { ClientType, Innertube, Platform, UniversalCache } from "youtubei.js";

import {
  HttpPoTokenProvider,
  type PoTokenProvider,
} from "./http-po-token-provider.js";
import { YoutubeOAuth } from "../../lib/youtube-oauth.js";

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
  readonly youtubeClientId?: string;
  readonly youtubeClientSecret?: string;
  readonly youtubeRefreshToken?: string;
}

export interface YoutubeiClientHandle {
  readonly client: Innertube;
  readonly poTokens?: PoTokenProvider;
  readonly oauth?: YoutubeOAuth;
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

  const oauth =
    options.youtubeClientId !== undefined &&
    options.youtubeClientSecret !== undefined &&
    options.youtubeRefreshToken !== undefined
      ? new YoutubeOAuth({
          clientId: options.youtubeClientId,
          clientSecret: options.youtubeClientSecret,
          refreshToken: options.youtubeRefreshToken,
        })
      : undefined;

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
    .then(async (client) => {
      if (oauth !== undefined && options.youtubeRefreshToken !== undefined) {
        try {
          const accessToken = await oauth.getAccessToken();
          await client.session.signIn({
            access_token: accessToken,
            refresh_token: options.youtubeRefreshToken,
            token_type: "Bearer",
            expires_in: 3600,
            expiry_date: new Date(Date.now() + 3600 * 1000).toISOString(),
          });
        } catch {
          // OAuth failed, continue without authentication
          // This is expected if the tokens are invalid or expired
        }
      }
      return {
        client,
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
