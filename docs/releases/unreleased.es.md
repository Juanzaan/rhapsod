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
- Mostrar las etiquetas de los separadores como encabezados simples que no se pueden unir ni mover, y ordenar los hermanos por cadenas de channel_order como el cliente TeamSpeak.
- Rechazar escrituras al panel que no sean JSON del mismo origen, para que una página abierta con el túnel SSH activo ya no pueda ejecutar comandos ni reiniciar el bot con las credenciales guardadas del navegador. Las páginas del panel ya no incluyen la contraseña.
- Validar la configuración del panel con las reglas de arranque antes de guardar, rechazar valores con saltos de línea, conservar comentarios y permisos del archivo de entorno, y dejar de solo lectura las rutas de yt-dlp, FFmpeg y ffprobe desde la web.
- No iniciar el panel con una contraseña por defecto publicada (`rhapsod`, `change-me`, `admin`, `password`).
- Guardar favoritos, historial, telemetría y cola antes de cada salida: reinicio desde el panel, watchdog, errores no controlados y reconexión fallida. El apagado espera como máximo 5 segundos en lugar de como mínimo 5. Los registros de errores conservan el mensaje.
- Tratar el panel como administrador, para que saltar o quitar pistas de otros usuarios funcione desde la web.
- La actualización semanal de yt-dlp ya no reinicia el bot: el servicio usa `Wants=` sobre el servicio auxiliar en lugar de `Requires=`, y la actualización reintenta pip con `--break-system-packages` en Debian 12 y Ubuntu 24.04.
- Ocultar tokens bearer y cabeceras de cookies completas en registros y diagnósticos.

## Actualización

Se requiere Node.js >=22.19.0. Respaldar configuración y datos, ejecutar `npm ci` y `npm run build`, y reiniciar cuando `/api/state` indique `playerState: "idle"`.

Si el panel usa una contraseña por defecto no se iniciará; definir antes una `RHAPSOD_PANEL_PASSWORD` única. Las instalaciones existentes conservan la línea `Requires=` en `/etc/systemd/system/rhapsod.service` hasta volver a ejecutar el instalador: cambiarla por `Wants=` y ejecutar `systemctl daemon-reload`.

Docker Compose utiliza la red del host Linux para mantener panel y servicio en localhost. Revisar la guía de despliegue antes de recrear contenedores. Los formatos de datos existentes siguen siendo compatibles.

## Verificación

Ejecutar `npm run check` y `npm run test:coverage`. Probar un reinicio en reposo antes de usar favoritos o estadísticas y confirmar que se conservan. Comprobar reproducción, radio, ajustes del panel y alternativa del servicio en el despliegue de destino.
