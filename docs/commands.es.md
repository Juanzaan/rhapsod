# Comandos

[English](commands.md)

Los comandos utilizan `!` por defecto y se procesan en el chat de TeamSpeak cuando el adaptador está conectado. `!help` muestra el resumen generado desde el registro de comandos.

| Comando                               | Alias                 | Función                                                                      |
| ------------------------------------- | --------------------- | ---------------------------------------------------------------------------- |
| `!play <URL o búsqueda>`              | `!p`                  | Añadir un enlace compatible o buscar música.                                 |
| `!playnext <URL o búsqueda>`          | `!pn`, `!next`        | Añadir una pista al principio de la cola pendiente.                          |
| `!yt [n] <búsqueda>`                  | `!search`, `!youtube` | Elegir un resultado clasificado; respeta la fuente preferida.                |
| `!pause` / `!resume`                  | -                     | Pausar o continuar.                                                          |
| `!skip`                               | `!s`                  | Saltar la pista actual con permiso de solicitante o administrador.           |
| `!previous`                           | `!prev`               | Repetir la última pista terminada.                                           |
| `!seek <segundos>`                    | -                     | Cambiar la posición de reproducción.                                         |
| `!stop`                               | -                     | Detener la reproducción y vaciar la sesión.                                  |
| `!queue [página]`                     | `!q`                  | Mostrar 10 pistas por página y tiempo restante conocido.                     |
| `!history`                            | `!hist`               | Mostrar las 10 últimas pistas iniciadas.                                     |
| `!now-playing`                        | `!np`, `!now`         | Mostrar pista, duración y solicitante; incluye título de radio.              |
| `!stats`                              | `!st`                 | Mostrar actividad, cola, volumen y estado del audio.                         |
| `!volume <0-100>`                     | `!vol`, `!v`          | Ajustar volumen persistente; valor predeterminado 50.                        |
| `!move <origen> <destino>`            | `!mv`                 | Mover una pista pendiente.                                                   |
| `!channel-move <canal>`               | `!ch`                 | Mover el bot de canal; solo administradores.                                 |
| `!diag`                               | -                     | Diagnóstico interno; solo administradores.                                   |
| `!debug-server`                       | `!ds`                 | Información del servidor; solo administradores.                              |
| `!chart`                              | -                     | Gráfico de actividad; solo administradores.                                  |
| `!remove <n\|inicio-fin>`             | `!rm`                 | Eliminar pistas propias o, con permisos, ajenas.                             |
| `!clear`                              | `!c`                  | Vaciar pistas pendientes.                                                    |
| `!shuffle`                            | -                     | Mezclar pistas pendientes.                                                   |
| `!loop [off\|track\|queue]`           | -                     | Repetición persistente de pista o cola.                                      |
| `!lyrics`                             | `!ly`                 | Buscar letras mediante LRCLIB.                                               |
| `!bassboost [1-5]`                    | `!bb`                 | Aplicar refuerzo de graves.                                                  |
| `!nightcore [1.05-1.35]`              | `!nc`                 | Aumentar velocidad.                                                          |
| `!vaporwave [0.80-0.95]`              | `!vw`                 | Reducir velocidad.                                                           |
| `!8d`                                 | -                     | Aplicar efecto espacial.                                                     |
| `!filter [off]`                       | -                     | Mostrar o desactivar el filtro.                                              |
| `!effects <efecto> [on\|off]`         | -                     | Controlar efectos; admite `list` y `reset`.                                  |
| `!playlist <subcomando>`              | `!pl`                 | `save`, `load`, `list`, `show`, `delete`, `add`, `remove`, `rename`, `info`. |
| `!fav` / `!favs`                      | -                     | Guardar la pista actual o listar favoritos.                                  |
| `!unfav <n>`                          | -                     | Eliminar un favorito por posición.                                           |
| `!favplay <n>`                        | `!fp`                 | Añadir un favorito a la cola.                                                |
| `!fuente [youtube\|soundcloud\|auto]` | -                     | Consultar o elegir fuente de búsqueda.                                       |
| `!radio <nombre o género>`            | `!rb`                 | Buscar y sintonizar una emisora.                                             |
| `!jump <posición>`                    | `!j`                  | Saltar a una posición con permisos sobre las pistas descartadas.             |
| `!tops [n]`                           | `!top`                | Mostrar pistas más escuchadas; 5 por defecto, máximo 10.                     |
| `!mystats`                            | -                     | Mostrar estadísticas personales y favoritos.                                 |
| `!autoplay [on\|off]`                 | -                     | Continuar con pistas relacionadas al vaciarse la cola.                       |
| `!test-tone`                          | `!tone`               | Emitir un tono de 3 segundos con límite de frecuencia.                       |
| `!help`                               | `!h`                  | Mostrar ayuda.                                                               |

## Permisos y persistencia

La mayoría de los comandos están disponibles para todos. `RHAPSOD_ADMIN_UIDS` permite saltar o eliminar pistas ajenas y usar comandos administrativos. `!jump` verifica permisos sobre cada pista descartada. Cualquier usuario puede saltar una pista automática.

Los favoritos se guardan por UID en `data/user-preferences.json`, con un máximo de 50 por usuario. Volumen, repetición y reproducción automática se guardan en `data/state.json`. `!stop` y `!clear` desactivan la repetición y cancelan la continuación pendiente. Con `RHAPSOD_INSTANCE_ID`, los archivos están dentro del directorio de instancia.

La cola usa posiciones desde 1. `!remove inicio-fin` incluye ambos extremos y limita el rango al final de la cola. `!playnext` admite una pista; usar `!play` para listas de YouTube. El tiempo restante incluye solo duraciones conocidas.

## Fuentes y búsqueda

- YouTube: videos y listas, hasta 100 pistas por expansión; se omiten duplicados. La búsqueda clasifica coincidencias y permite elegir el resultado número `n`.
- SoundCloud: interfaz web pública con identificador temporal, búsqueda de pistas y expansión nativa de listas. yt-dlp y alternativas de SongLink o YouTube actúan como respaldo. No se elude contenido bloqueado o DRM.
- Spotify: solo metadatos de pistas, álbumes y listas; reproducción mediante coincidencias en YouTube. Las listas usan metadatos públicos o Web API según las credenciales disponibles.
- Apple Music y Amazon Music: resolución mediante SongLink a YouTube o SoundCloud disponibles.
- Audio directo: URL HTTPS públicas de archivos, HLS y emisoras. Se rechazan HTTP, redes privadas y archivos locales.
- Radio: directorio comunitario con alternativa TuneIn. Los títulos en directo dependen de metadatos ICY de la emisora.

`!fuente soundcloud` dirige las búsquedas de texto de `!play` y `!yt` a SoundCloud; sin resultados se usa YouTube. `auto` utiliza YouTube. Los enlaces conservan su proveedor.

## Reproducción automática

`!autoplay on` usa mezclas y pistas relacionadas de YouTube, señales de escucha personal y del canal, coincidencias de títulos y continuidad de energía estimada. Limita repeticiones y concentración de artistas. Sin pistas iniciales permanece en silencio; las solicitudes a proveedores tienen tiempo limitado.

Rhapsod pasa argumentos directamente a los procesos hijos; los comandos de chat no ejecutan sintaxis de shell.
