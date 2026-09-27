import { isDrmError } from "./drm-error.js";
import { messages } from "./messages.js";
import { UserError } from "./user-error.js";

export function userFacingError(error: Error): string {
  if (error instanceof UserError) return error.message;
  if (isDrmError(error)) return messages.errorDrmSoundcloud;
  const msg = error.message;
  if (/Requested format is not available/i.test(msg))
    return messages.errorFormatoNoDisponible;
  if (/fetch failed/i.test(msg)) return messages.errorFalloDeRed;
  return messages.errorGenerico;
}
