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

/**
 * The line !stats adds while the daily YouTube check fails: what to do about
 * it, for an owner who never read about WARP or cookies. The installer no
 * longer sets up WARP by default, so a blocked VPS address is where the
 * owner learns it exists.
 */
export function youtubeAuthHint(
  category: YoutubeAuthFailureCategory | undefined,
  warpConfigured: boolean,
): string {
  switch (category) {
    case "cookies-invalid":
      return "YouTube pide iniciar sesión: cargá las cookies de una cuenta en el paso YouTube del panel.";
    case "soft-block":
      return warpConfigured
        ? "YouTube bloquea al bot aun con WARP: cargá las cookies de una cuenta en el paso YouTube del panel."
        : "YouTube bloquea la IP del servidor, algo común en un VPS. Activá WARP volviendo a correr el instalador con RHAPSOD_WITH_WARP=1, o cargá cookies en el panel.";
    default:
      return "No pude obtener audio de YouTube; revisá los logs del bot.";
  }
}
