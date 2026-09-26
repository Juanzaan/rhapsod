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
- Aceptar `!channel-move` mientras el bot no puede hablar en su canal: es el comando que lo saca de ahí y antes se ignoraba junto con todos los demás. Los permisos de movimiento siguen aplicando.

## Actualización

Se requiere Node.js >=22.19.0. Respaldar configuración y datos, ejecutar `npm ci` y `npm run build`, y reiniciar cuando `/api/state` indique `playerState: "idle"`.

Si el panel usa una contraseña por defecto no se iniciará; definir antes una `RHAPSOD_PANEL_PASSWORD` única. Las instalaciones existentes conservan la línea `Requires=` en `/etc/systemd/system/rhapsod.service` hasta volver a ejecutar el instalador: cambiarla por `Wants=` y ejecutar `systemctl daemon-reload`.

Docker Compose utiliza la red del host Linux para mantener panel y servicio en localhost. Revisar la guía de despliegue antes de recrear contenedores. Los formatos de datos existentes siguen siendo compatibles.

## Verificación

Ejecutar `npm run check` y `npm run test:coverage`. Probar un reinicio en reposo antes de usar favoritos o estadísticas y confirmar que se conservan. Comprobar reproducción, radio, ajustes del panel y alternativa del servicio en el despliegue de destino.
