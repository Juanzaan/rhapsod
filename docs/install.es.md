# Instalación

[English](install.md)

Usar un servidor Linux permanente con acceso UDP saliente a TeamSpeak. El instalador admite x86_64 con Ubuntu 20.04+, Debian 11+ y sistemas de la familia RHEL 9+. El consumo depende de la cola y la concurrencia de extracción; medir memoria de FFmpeg y yt-dlp junto con Node.

## Instalador para VPS

```bash
curl -fsSL https://raw.githubusercontent.com/Juanzaan/rhapsod/main/install.sh | sudo bash
```

El instalador selecciona la última etiqueta estable, instala Node 22 si falta, yt-dlp, FFmpeg, el servicio Python y servicios auxiliares opcionales, y crea unidades systemd. Una instalación existente de Node debe ser >=22.19.0. Las instalaciones nuevas reciben `.env`, un archivo de cookies vacío y una contraseña generada; repetir el instalador conserva configuración y cookies.

El bot inicia solo el panel con `RHAPSOD_TS3_AUTO_CONNECT=false`. Abrir un túnel:

```bash
ssh -N -L 8080:127.0.0.1:8080 user@host
```

Abrir `http://127.0.0.1:8080/setup`, acceder con las credenciales mostradas y configurar TeamSpeak, canal, audio y YouTube. Guardar TeamSpeak activa la conexión automática para el siguiente inicio. Mantener el panel en `127.0.0.1`.

Las opciones del instalador son `RHAPSOD_REF`, `RHAPSOD_APP_DIR`, `RHAPSOD_USER` y `RHAPSOD_SKIP_WARP=1`. Pasarlas explícitamente al proceso privilegiado:

```bash
curl -fsSL https://raw.githubusercontent.com/Juanzaan/rhapsod/main/install.sh -o /tmp/rhapsod-install.sh
sudo env RHAPSOD_SKIP_WARP=1 bash /tmp/rhapsod-install.sh
```

El instalador configura una actualización semanal de yt-dlp. Actualizar Rhapsod por separado mediante el [procedimiento de despliegue](deployment.es.md).

## Instalación manual

Instalar Node.js >=22.19.0, yt-dlp, FFmpeg y ffprobe. Después:

```bash
git clone https://github.com/Juanzaan/rhapsod.git
cd rhapsod
npm ci
cp .env.example .env
```

Configurar `RHAPSOD_TS3_HOST`. Para configurar primero desde el navegador, establecer también:

```dotenv
RHAPSOD_TS3_AUTO_CONNECT=false
RHAPSOD_PANEL_ENABLED=true
RHAPSOD_PANEL_HOST=127.0.0.1
RHAPSOD_PANEL_PASSWORD=replace-with-a-unique-password
```

```bash
npm run build
npm start
```

Usar `RHAPSOD_YTDLP_PATH`, `RHAPSOD_FFMPEG_PATH` y `RHAPSOD_FFPROBE_PATH` si las herramientas no están en PATH. El servicio opcional escucha en `127.0.0.1:8765`; configurar `RHAPSOD_YTDLP_DAEMON_URL` solo si está ejecutándose. Consultar [despliegue](deployment.es.md) para servicios y Docker.

## Verificación

```bash
node --version
yt-dlp --version
ffmpeg -version
ffprobe -version
```

Confirmar que el bot entra en su canal, solicitar una pista con `!play` y revisar `!stats`. En instalaciones con el script, revisar `systemctl status rhapsod rhapsod-ytdlp-daemon` y `journalctl -u rhapsod -n 100 --no-pager`.

## Resolución de problemas

- Fallo de conexión: revisar host, puerto de voz, contraseñas y permisos. El asistente permite probar la conexión.
- Fallo de YouTube: actualizar yt-dlp según su método de instalación y revisar su estado en el panel. Si requiere autenticación, configurar cookies de una cuenta autorizada mediante el asistente o `RHAPSOD_YTDLP_COOKIES_PATH`.
- Fallo al guardar ajustes: `RHAPSOD_ENV_FILE` debe apuntar a un archivo escribible por el usuario del servicio. Para `/etc/rhapsod.env` con `ProtectSystem=full`, añadir `ReadWritePaths=/etc/rhapsod.env` en una modificación de systemd y ajustar la propiedad del archivo.
- Fallo de permisos de datos: el usuario del servicio debe ser propietario de `RHAPSOD_DATA_DIR` y poder crear archivos temporales junto a los JSON persistentes.

Tras modificar unidades, ejecutar `sudo systemctl daemon-reload`; esperar al reposo antes de reiniciar.
