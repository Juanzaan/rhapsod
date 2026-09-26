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
| `!playlist <subcomando>`              | `!pl`                 | `save`, `load`, `list`, `show`, `delete`, `add`, `remove`, `rename`, `info`. |
| `!fav` / `!favs`                      | -                     | Guardar la pista actual o listar favoritos.                                  |
| `!unfav <n>`                          | -                     | Eliminar un favorito por posición.                                           |
| `!favplay <n>`                        | `!fp`                 | Añadir un favorito a la cola.                                                |
| `!fuente [youtube\|soundcloud\|auto]` | -                     | Consultar o elegir fuente de búsqueda.                                       |
| `!radio <nombre, género o link>`      | `!rb`                 | Buscar y sintonizar una emisora; los enlaces de TuneIn suenan directo.       |
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
- Apple Music: canciones y álbumes mediante datos de iTunes y búsqueda en YouTube. Las listas se expanden igual que las colecciones de Spotify.
- Amazon Music: resolución mediante SongLink a YouTube o SoundCloud disponibles.
- Audio directo: URL HTTPS públicas de archivos, HLS y emisoras. Se rechazan HTTP, redes privadas y archivos locales.
- Radio: directorio comunitario con alternativa TuneIn. Los enlaces pegados de TuneIn (páginas y acortados tun.in) suenan directo. Los títulos en directo dependen de metadatos ICY de la emisora.

`!fuente soundcloud` dirige las búsquedas de texto de `!play` y `!yt` a SoundCloud; sin resultados se usa YouTube. `auto` utiliza YouTube. Los enlaces conservan su proveedor.

## Reproducción automática

`!autoplay on` mantiene la música al vaciarse la cola rotando tres fuentes: cada diez pistas elige cuatro parecidas, tres clásicas y tres descubrimientos.

- **Parecidas:** la mezcla de YouTube de lo que acaba de sonar, ordenada según quien viene pidiendo (afinidad por artista y palabras del título en sus sesiones recientes, continuidad de energía con la última pista).
- **Clásicas:** pistas que el canal pidió y dejó sonar antes, con al menos seis horas de descanso; las que se saltan más de lo que se terminan no vuelven.
- **Descubrimientos:** pistas que el canal nunca escuchó, tomadas de la mezcla de YouTube de un artista de los más escuchados en el canal.

Las elecciones de la reproducción automática no cuentan como pedidos: no suben en `!tops` ni en el perfil de gustos, así que no se refuerza a sí misma. Saltar una de sus pistas cuenta en contra de esa pista, y su fuente queda fuera los dos turnos siguientes. Si una fuente no tiene nada para ofrecer, la siguiente la reemplaza; sin historial permanece en silencio. Las mezclas obtenidas se reutilizan durante 30 minutos y las solicitudes a proveedores tienen tiempo limitado. Las canciones de la radio en directo entran al mismo historial cuando la emisora las nombra en sus metadatos, para que la rotación también alimente las clásicas y `!tops`.

Rhapsod pasa argumentos directamente a los procesos hijos; los comandos de chat no ejecutan sintaxis de shell.
