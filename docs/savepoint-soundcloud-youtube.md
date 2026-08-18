# Savepoint: SoundCloud y alternativas de YouTube

Fecha: 2026-08-19

## Estado del repositorio

- Rama: `main`
- Último commit: `b6b0f72 feat(soundcloud): add resilient public api resolver`
- Estado: limpio y sincronizado con `origin/main`
- Stack: Node 22, TypeScript, yt-dlp, FFmpeg y cliente TeamSpeak 3

## Funcionalidad implementada

- Resolución de enlaces SoundCloud largos y `on.soundcloud.com`.
- Adaptador aislado `src/media/soundcloud/public-api.ts`.
- Descubrimiento dinámico y caché temporal del `client_id` del frontend.
- Renovación del identificador después de respuestas `401`.
- Preferencia por transcoding progresivo y fallback HLS.
- Rechazo explícito de pistas `blocked`, `DRM` o no streamable.
- Fallback a yt-dlp cuando el adaptador SoundCloud no está disponible.
- Fallback SongLink hacia YouTube cuando existe una equivalencia.
- Errores de SongLink tratados como best-effort, sin propagar timeouts al chat.

## Limitación observada

Para `https://on.soundcloud.com/0Tbj4O1F7XxfV6DDjQ`, SongLink resuelve el tema
como `OK (feat. Don Toliver)` de Kanye West/Ye y Don Toliver, pero no devuelve
ningún enlace de YouTube. SoundCloud marca el recurso como DRM, por lo que el
bot informa correctamente que no hay stream autorizado.

## Decisión de diseño pendiente

Agregar un segundo fallback basado en búsqueda por metadatos:

1. Obtener título y artista de SoundCloud antes de devolver el error DRM.
2. Consultar SongLink primero.
3. Si no hay YouTube, buscar con yt-dlp usando título + artista.
4. Puntuar resultados por coincidencia de artista/título, duración y categoría.
5. Rechazar Shorts, directos, remixes y resultados claramente incorrectos.

YouTube Music no ofrece una API pública independiente adecuada para este flujo.
La búsqueda debe usar el backend de YouTube mediante yt-dlp; se puede priorizar
contenido musical por filtros y puntuación, pero no se debe depender de APIs
privadas de YouTube Music.

## Reglas de seguridad y legalidad

- No evadir DRM ni acceder a streams bloqueados.
- No copiar `client_id` fijo desde otro bot.
- No guardar cookies ni credenciales en Git.
- Mantener SongLink y la búsqueda como alternativas de disponibilidad, no como
  mecanismos para saltar restricciones de derechos.

## Próximo trabajo

- Investigar la salida completa de `yt-dlp ytsearch` para diseñar el ranking.
- Definir tolerancias de duración y normalización de títulos/artistas.
- Añadir pruebas unitarias del ranking y de la selección de resultados.
- Implementar el fallback de búsqueda solo después de validar falsos positivos.
