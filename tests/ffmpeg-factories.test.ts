import { describe, expect, it, vi } from "vitest";
import type {
  createPcmStream,
  FfmpegPlaybackSession,
  playFfmpegUrl,
} from "../src/audio/ffmpeg-player.js";
import { ffmpegFactories } from "../src/bootstrap/ffmpeg-factories.js";

const host = {
  binary: "/opt/ffmpeg",
  egressProxyUrl: "http://127.0.0.1:9000",
  peakLimiter: true,
  userAgent: "UA",
  proxyUrl: "http://127.0.0.1:40000",
};

describe("ffmpegFactories", () => {
  it("passes the non-music end to cold starts", () => {
    const play = vi.fn<typeof playFfmpegUrl>(
      () => ({}) as FfmpegPlaybackSession,
    );
    const { createPlayback } = ffmpegFactories(host, play);
    createPlayback("https://a", {} as never, {} as never, {
      seekSeconds: 12,
      endSeconds: 200,
      loudnessTargetLufs: -14,
    });
    expect(play.mock.calls[0]?.[3]).toEqual({
      seekSeconds: 12,
      endSeconds: 200,
      loudnessTargetLufs: -14,
      ...host,
    });
  });

  it("keeps the host settings over per-track ones and no WARP on prewarm", () => {
    const pcm = vi.fn<typeof createPcmStream>(() => ({}) as never);
    const { createPcmStream: create } = ffmpegFactories(host, undefined, pcm);
    create("https://a", { endSeconds: 90, binary: "ffmpeg" });
    expect(pcm.mock.calls[0]?.[1]).toEqual({
      endSeconds: 90,
      binary: "/opt/ffmpeg",
      egressProxyUrl: host.egressProxyUrl,
      peakLimiter: true,
      userAgent: "UA",
    });
  });
});
