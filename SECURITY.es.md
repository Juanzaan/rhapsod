# Política de seguridad

[English](SECURITY.md)

## Versiones admitidas

Solo la última versión estable recibe correcciones de seguridad. Las
correcciones llegan a `main` y se publican en la siguiente versión 3.x.

| Versión | Admitida            |
| ------- | ------------------- |
| 3.x     | Sí (solo la última) |
| 2.x     | No                  |
| 1.x     | No                  |
| < 1.0   | No                  |

## Informar una vulnerabilidad

**No** abrir un issue público para exposición de credenciales, ejecución
remota de código, omisión de autenticación u otras vulnerabilidades
explotables. Usar el reporte privado de vulnerabilidades de GitHub:

1. Ir a <https://github.com/Juanzaan/rhapsod/security/advisories>.
2. Indicar las versiones afectadas, los pasos para reproducir, el impacto y
   las mitigaciones conocidas.
3. No incluir credenciales reales de TeamSpeak, cookies de yt-dlp,
   contraseñas del panel ni tokens de Spotify en el informe.

Los informes se confirman en un plazo de 5 días hábiles, con un calendario
para la corrección y la divulgación una vez publicada.

## Postura de seguridad del proyecto

- **Secretos** (contraseñas de TeamSpeak, contraseña del panel, cookies de
  yt-dlp, secreto de cliente y token de actualización de Spotify): solo en
  `.env` o en el almacén de secretos del despliegue, nunca en Git. El
  instalador crea `.env` con permisos 0600.
- **Sin ejecución de shell**: `ffmpeg`, `ffprobe` y `yt-dlp` reciben sus
  argumentos directamente; Rhapsod nunca invoca un shell. Las rutas de los
  binarios son de solo lectura desde el panel.
- **Panel**: escucha en `127.0.0.1`, se accede por un túnel SSH y requiere
  autenticación básica. Las escrituras deben ser JSON del mismo origen, el
  panel no se inicia con una contraseña por defecto publicada y solo puede
  escribir claves `RHAPSOD_*` conocidas, validadas con las reglas de
  arranque.
- **Solicitudes salientes**: las URL que envían los usuarios pasan por una
  protección SSRF que rechaza direcciones privadas, de loopback y de enlace
  local en cada redirección.
- **Derechos de contenido**: las pistas protegidas con DRM o bloqueadas se
  informan con un mensaje claro y nunca se eluden.
- **Spotify**: solo metadatos, nunca fuente de reproducción. El flujo de
  credenciales de cliente cubre pistas, álbumes y listas públicas. Un token
  de actualización opcional (`RHAPSOD_SPOTIFY_REFRESH_TOKEN`, creado con
  `node scripts/spotify-auth.mjs`) concede `playlist-read-private` para leer
  las listas que ve el propietario; no se usa para nada más.
- **Privilegio mínimo**: las unidades systemd se ejecutan con un usuario
  dedicado, `NoNewPrivileges` y `PrivateTmp`; el servicio de yt-dlp agrega
  `ProtectSystem=strict` y `ProtectHome=read-only`. El bot solo necesita
  permisos para entrar, hablar y usar el chat en el servidor TeamSpeak.
