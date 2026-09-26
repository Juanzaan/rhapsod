import { UserError } from "./user-error.js";

export function userFacingError(error: Error): string {
  if (error instanceof UserError) return error.message;
  const msg = error.message;
  if (/DRM protected/i.test(msg))
    return "SoundCloud no permite reproducir esta pista porque está protegida con DRM. Probá otra versión o una fuente distinta.";
  if (/Requested format is not available/i.test(msg))
    return "YouTube no ofrece un formato de audio reproducible para ese video (puede ser un directo o un video restringido). Probá otra versión.";
  if (/fetch failed/i.test(msg))
    return "Fallo momentáneo de red con el proveedor (Spotify/YouTube). Probá de nuevo en unos segundos.";
  if (/ya está en la cola/i.test(msg)) return "Esa canción ya está en la cola.";
  return "Ocurrió un error. Probá de nuevo en unos segundos.";
}
