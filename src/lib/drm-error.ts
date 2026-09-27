export class DrmProtectedError extends Error {}

// yt-dlp reports DRM only in its stderr text ("This video is DRM protected"),
// so errors from that process are matched by message; our own resolvers
// throw DrmProtectedError subclasses instead.
const YTDLP_DRM_MESSAGE = /DRM protected/i;

export function isDrmError(error: unknown): boolean {
  if (error instanceof DrmProtectedError) return true;
  return error instanceof Error && YTDLP_DRM_MESSAGE.test(error.message);
}
