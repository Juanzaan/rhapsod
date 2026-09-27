import { createPcmStream, playFfmpegUrl } from "../audio/ffmpeg-player.js";

export interface HostFfmpegOptions {
  readonly binary?: string;
  readonly egressProxyUrl?: string;
  readonly peakLimiter: boolean;
  readonly userAgent?: string;
  readonly proxyUrl?: string;
}

export interface FfmpegFactories {
  readonly createPlayback: typeof playFfmpegUrl;
  readonly createPcmStream: typeof createPcmStream;
}

/**
 * Host settings go over whatever the controller asks per track. The
 * per-track options pass through whole: listing them one by one dropped
 * endSeconds on cold starts, so the non-music outro played anyway.
 */
export function ffmpegFactories(
  host: HostFfmpegOptions,
  play: typeof playFfmpegUrl = playFfmpegUrl,
  pcm: typeof createPcmStream = createPcmStream,
): FfmpegFactories {
  const shared = {
    ...(host.binary === undefined ? {} : { binary: host.binary }),
    ...(host.egressProxyUrl === undefined
      ? {}
      : { egressProxyUrl: host.egressProxyUrl }),
    peakLimiter: host.peakLimiter,
    ...(host.userAgent === undefined ? {} : { userAgent: host.userAgent }),
  };
  return {
    createPlayback: (url, encoder, output, options) =>
      play(url, encoder, output, {
        ...options,
        ...shared,
        ...(host.proxyUrl === undefined ? {} : { proxyUrl: host.proxyUrl }),
      }),
    // Prewarmed next-track streams need the same binary and User-Agent as
    // cold starts; the default factory used to fall back to ffmpeg-static.
    createPcmStream: (url, options) => pcm(url, { ...options, ...shared }),
  };
}
