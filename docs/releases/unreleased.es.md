[English](unreleased.md)

## Resumen

Correcciones de persistencia, actualización de dependencias, reparación del despliegue y documentación bilingüe uniforme de versiones.

## Cambios

- Extensión del diseño a ajustes, comandos, asistente y servidor; búsqueda de canales, recuentos y expansión o contracción. Corrección de nombres de canales, canales sin padre visible y ajustes de solo lectura.
- Visualización de todos los canales visibles, incluidos los vacíos: el árbol se descubre consultando `channelinfo` por identificador en segundo plano (los clientes de voz no pueden ejecutar `channellist`); se actualiza al iniciar, al reconectar y cada diez minutos.
- Rediseño del panel con distribución adaptable, fondos animados locales, preferencias de movimiento, controles de radio y reproducción automática y búsqueda de posición con teclado.
- Conservación de favoritos e historial sin cargar al cerrar; rechazo de posiciones de favoritos no válidas.
- Límite de pistas en memoria y caducidad del refuerzo de sesión tras inactividad.
- Actualización de dependencias compatibles, incluidas libopus-wasm, Hono, Zod y Vitest.
- Renovación visual del panel y prevención de respuestas antiguas, con reintento de carga de ajustes.
- Reparación de Python y del inicio del servicio en Docker; conservación de configuración y cookies al repetir el instalador.
- Notas históricas y futuras uniformes en inglés y español, con instrucciones de actualización y verificación.
- Mantener la reproducción automática tras un reinicio: el historial reciente alimenta la rotación y recupera el gusto del último oyente, en lugar de iniciar en silencio.
- Reproducir emisoras que rechazan la comprobación HEAD: las estaciones Icecast y Shoutcast que responden 400 se confirman con una petición GET de un byte, con tipos de contenido AAC de Shoutcast añadidos.
- Reproducir enlaces pegados de TuneIn (acortados tun.in y páginas tunein.com) en !play y !radio, resolviéndolos a la emisión.
- Comprobar emisoras directas en ffprobe sin -max_redirects (7.0.x estático): el bloqueo de redirecciones solo se envía si el binario lo acepta.
- Resolver enlaces de canciones, álbumes y listas de Apple Music con iTunes sin clave tras el retiro del acceso anónimo de SongLink; las listas se expanden como las colecciones de Spotify. Amazon Music sigue en SongLink.
- Utilizar el mismo fondo animado, selector de ambiente y control de movimiento en todas las páginas del panel, no solo en la consola.
- Se quitan los filtros de audio (`!bassboost`, `!nightcore`, `!vaporwave`, `!8d`, `!filter`, `!effects`) y sus controles en el panel. Casi no se usaban y reiniciaban el stream en cada cambio; un filtro guardado en `data/state.json` por una versión anterior se ignora al cargar.
- La reproducción automática pasa a funcionar como un DJ que rota pistas parecidas, clásicas del canal (pedidas y terminadas antes, con seis horas de descanso) y descubrimientos de los artistas favoritos del canal. Sus propias elecciones dejan de contar como pedidos en `!tops` y en el perfil de gustos; el historial existente se corrige una vez al cargarse. Las pistas saltadas dejan su fuente fuera dos turnos y las mezclas obtenidas se reutilizan durante 30 minutos.
- ffmpeg y ffprobe ya no descargan URLs HTTP sin cifrar listadas dentro de playlists HLS (por ejemplo, la dirección de metadatos de la nube o el daemon local de yt-dlp): toda apertura anidada queda restringida a TLS. Además se dejan de registrar las URLs del stream y la salida de error de ffmpeg al terminar cada pista.
- Panel con más vida: color propio por pista en el reproductor, los controles y el fondo, brazo que baja sobre el disco, barras de ecualizador decorativas, barra de progreso que avanza sin saltos, aparición escalonada de tarjetas, contadores animados, ondas al pulsar botones y resaltado de tarjetas que sigue al cursor. Las animaciones que dependían de una biblioteca que nunca se cargaba ahora se ejecutan localmente y respetan el control de movimiento y la reducción de movimiento del sistema. Ajustes, Comandos, Servidor y el asistente comparten ese movimiento: etiquetas de ajustes por significado con seguimiento de cambios sin guardar, comandos que se copian al pulsarlos con coincidencias resaltadas, contadores animados del servidor, disco giratorio en el asistente con pasos que se deslizan, fundido entre páginas y tarjetas que aparecen al desplazarse. El panel suma un indicador de tiempo en la barra de progreso, relleno de volumen en vivo, salida animada de pistas quitadas y un estado gris sin conexión. El panel también sirve su propio favicon.
- Mostrar las etiquetas de los separadores como encabezados simples que no se pueden unir ni mover, y ordenar los hermanos por cadenas de channel_order como el cliente TeamSpeak.
- Rechazar escrituras al panel que no sean JSON del mismo origen, para que una página abierta con el túnel SSH activo ya no pueda ejecutar comandos ni reiniciar el bot con las credenciales guardadas del navegador. Las páginas del panel ya no incluyen la contraseña.
- Validar la configuración del panel con las reglas de arranque antes de guardar, rechazar valores con saltos de línea, conservar comentarios y permisos del archivo de entorno, y dejar de solo lectura las rutas de yt-dlp, FFmpeg y ffprobe desde la web.
- No iniciar el panel con una contraseña por defecto publicada (`rhapsod`, `change-me`, `admin`, `password`).
- Guardar favoritos, historial, telemetría y cola antes de cada salida: reinicio desde el panel, watchdog, errores no controlados y reconexión fallida. El apagado espera como máximo 5 segundos en lugar de como mínimo 5. Los registros de errores conservan el mensaje.
- Tratar el panel como administrador, para que saltar o quitar pistas de otros usuarios funcione desde la web.
- La actualización semanal de yt-dlp ya no reinicia el bot: el servicio usa `Wants=` sobre el servicio auxiliar en lugar de `Requires=`, y la actualización reintenta pip con `--break-system-packages` en Debian 12 y Ubuntu 24.04.
- Ocultar tokens bearer y cabeceras de cookies completas en registros y diagnósticos.
- Tratar `!seek`, los cambios de filtro y los reintentos por 403 como la misma reproducción: sin un segundo mensaje "Reproduciendo", sin sumar en las estadísticas, sin registrar un salto en el perfil de gustos, y `!previous` devuelve la pista anterior. La posición del panel continúa desde el punto de salto en lugar de volver a 0:00.
- Reanudar los reintentos por 403 donde se cortó el audio en lugar de repetir el comienzo de la pista, reintentar sin publicar un error en cada intento y volver a la radio en vivo en el punto actual. La detección de 403 busca el texto del error HTTP en lugar de cualquier "403" dentro de las URL.
- Usar el binario de FFmpeg y el User-Agent configurados para los flujos precargados de la pista siguiente; antes usaban el ffmpeg-static incluido.
- Espaciar los mensajes de chat un segundo aunque se encolen varios a la vez, registrar los mensajes descartados por la cola anti-flood, dividir los textos de más de 1024 caracteres (como `!help` o `!debug-server` en servidores grandes) en lugar de perderlos, y detectar un sondeo de heartbeat que nunca responde.
- `!stop` y `!clear` siguen la misma regla de propiedad que `!skip` y `!remove`: se rechazan si la cola tiene pistas de otro usuario, salvo para administradores. Las pistas automáticas y las de usuarios que ya salieron del servidor son comunes, así que las pistas de alguien ausente nunca bloquean la cola.
- Reforzar `scripts/spotify-auth.mjs`: el servidor del callback escucha solo en 127.0.0.1, la URL de autorización lleva un `state` aleatorio y los callbacks sin él se ignoran en vez de aceptarse o terminar el proceso, y el script ahora lee `.env` como indicaba su mensaje.
- Enviar cada conexión de ffmpeg y ffprobe a través de un control de salida local. Validar la URL de entrada no cubría lo que ffmpeg abre por su cuenta: un 302 a un host HTTP sin cifrar o un segmento HLS en uno de ellos llegaba a direcciones internas como el servicio de metadatos de la nube o el daemon de yt-dlp. El control resuelve cada destino, rechaza direcciones privadas y HTTP sin cifrar, y prefiere IPv4. Se quita `no_proxy` de su entorno para que no pueda eludirlo.
- Corregir el respaldo por WARP ante respuestas 403: ffmpeg rechaza `-timeout` junto con `-http_proxy`, así que el intento de respaldo terminaba antes de conectarse.
- Validar los tiempos de espera de yt-dlp (`RHAPSOD_YTDLP_SEARCH_TIMEOUT_MS`, `_AUDIO_URL_`, `_DOWNLOAD_`, `_METADATA_`, `_PLAYLIST_`) junto con el resto de la configuración: figuran en `.env.example`, se pueden editar desde el panel y un valor fuera de rango detiene el inicio en vez de ajustarse con un aviso en consola.
- Corregir el daemon de yt-dlp: los enlaces youtu.be, `/shorts/` y `/live/` ya no rompen la solicitud, dos solicitudes del mismo video ya no lo extraen dos veces, una solicitud que espera una extracción trabada se rinde a los 45 segundos, las URL en caché vencen en la hora firmada en la URL (menos 15 minutos) en vez de a las seis horas fijas, y las rutas desconocidas responden 404.
- Conservar los archivos de datos ilegibles: listas, favoritos, historial de escucha, biblioteca de canciones, telemetría o estado de reproducción que no se pueden leer se renombran a `<nombre>.corrupt-<hora>` en vez de ser reemplazados por el siguiente guardado. Cada escritura de datos se sincroniza con el disco antes del renombre, así que un corte de energía no puede dejar un archivo vacío.
- Aceptar `!channel-move` mientras el bot no puede hablar en su canal: es el comando que lo saca de ahí y antes se ignoraba junto con todos los demás. Los permisos de movimiento siguen aplicando.
- Comprobar las descargas del instalador y de la actualización semanal con las sumas publicadas, usar directorios temporales privados en lugar de rutas fijas en `/tmp`, crear el usuario de servicio con shell `nologin` y fijar el servidor y el complemento POT a la misma versión. Los contenedores Docker se ejecutan con el usuario sin privilegios `node` y Compose inicia el proveedor POT en loopback.
- Enviar seguidas las partes de un mensaje de chat dividido: otro mensaje encolado mientras tanto ya no puede quedar entre ellas.

## Actualización

Es una versión mayor porque quita comandos: `!bassboost`, `!nightcore`, `!vaporwave`, `!8d`, `!filter` y `!effects` ahora reciben la respuesta de comando desconocido. `!test-tone` y `!chart`, que también se podían usar como `!effects test-tone` y `!effects chart`, siguen como comandos propios. Un filtro guardado en `data/state.json` se ignora.

Se requiere Node.js >=22.19.0. Respaldar configuración y datos, ejecutar `npm ci` y `npm run build`, y reiniciar cuando `/api/state` indique `playerState: "idle"`.

Si el panel usa una contraseña por defecto no se iniciará; definir antes una `RHAPSOD_PANEL_PASSWORD` única. Las instalaciones existentes conservan la línea `Requires=` en `/etc/systemd/system/rhapsod.service` hasta volver a ejecutar el instalador: cambiarla por `Wants=` y ejecutar `systemctl daemon-reload`.

Instalaciones con Docker: ejecutar `sudo chown -R 1000:1000 data .env` antes de recrear los contenedores, que ahora se ejecutan con uid 1000.

Un tiempo de espera de yt-dlp fuera de rango ahora detiene el inicio. Antes de reiniciar, comparar cada línea `RHAPSOD_YTDLP_*_TIMEOUT_MS` de `grep TIMEOUT_MS /etc/rhapsod.env` con los rangos de `.env.example`.

Docker Compose utiliza la red del host Linux para mantener panel y servicio en localhost. Revisar la guía de despliegue antes de recrear contenedores. Los formatos de datos existentes siguen siendo compatibles.

## Verificación

Ejecutar `npm run check` y `npm run test:coverage`. Probar un reinicio en reposo antes de usar favoritos o estadísticas y confirmar que se conservan. Comprobar reproducción, radio, ajustes del panel y alternativa del servicio en el despliegue de destino.
