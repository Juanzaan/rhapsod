export type YoutubeAuthFailureCategory =
  "cookies-invalid" | "soft-block" | "extraction-failed";

const COOKIES_INVALID_RE =
  /sign in to confirm|cookies for the authentication|login required|authentication/i;

const SOFT_BLOCK_RE =
  /page needs to be reloaded|requested format is not available|not a bot|bot.?check/i;

export function classifyYoutubeAuthFailure(
  error: unknown,
): YoutubeAuthFailureCategory {
  const message = error instanceof Error ? error.message : String(error);
  if (COOKIES_INVALID_RE.test(message)) return "cookies-invalid";
  if (SOFT_BLOCK_RE.test(message)) return "soft-block";
  return "extraction-failed";
}
