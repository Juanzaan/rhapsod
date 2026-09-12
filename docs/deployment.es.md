# Despliegue

[English](deployment.md)

Ejecutar Rhapsod como servicio permanente con Node.js >=22.19.0, FFmpeg, ffprobe y yt-dlp. La línea activa es 3.x. El perfil histórico 1.x usaba 1 vCPU y 1 GB; el perfil 2.x usaba 4 vCPU y 3 GB. Ajustar despliegues actuales según memoria y estado del audio medidos.

## Configuración y estado

El proceso carga `.env` desde su directorio de trabajo. El entorno existente tiene prioridad. `RHAPSOD_ENV_FILE` selecciona el archivo que edita el panel; si systemd carga `/etc/rhapsod.env`, apuntar el panel al mismo archivo.

```dotenv
RHAPSOD_TS3_HOST=voice.example.com
RHAPSOD_TS3_PORT=9987
RHAPSOD_TS3_NICKNAME=Rhapsod
RHAPSOD_DATA_DIR=/var/lib/rhapsod
RHAPSOD_PANEL_ENABLED=true
RHAPSOD_PANEL_HOST=127.0.0.1
RHAPSOD_PANEL_PASSWORD=replace-with-a-unique-password
RHAPSOD_ENV_FILE=/etc/rhapsod.env
```

Conservar todo el directorio de datos: `ts3-identity.txt`, `state.json`, listas, preferencias, historial y cachés. Mantener entorno, identidades y cookies fuera de Git. Las credenciales de Spotify permiten consultar metadatos; un token de renovación opcional permite leer metadatos de listas con autenticación.

## systemd

El instalador crea unidades adaptadas a sus rutas. Los ejemplos manuales están en `deploy/systemd/`; revisar usuario, directorio de trabajo, ejecutables y dependencias antes de copiarlos. La unidad del bot requiere por defecto el servicio opcional; eliminar esa dependencia si solo se utiliza el ejecutable.

Para `/etc/rhapsod.env`, añadir una modificación mediante `sudo systemctl edit rhapsod`:

```ini
[Service]
EnvironmentFile=/etc/rhapsod.env
ReadWritePaths=/etc/rhapsod.env
```

El usuario del servicio necesita permiso de escritura para editar desde el panel. Usar `RestartPreventExitStatus=42` para evitar reinicios repetidos al rechazar una instancia duplicada. Confirmar que `ExecStart` usa la ruta de `command -v node`.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now rhapsod-ytdlp-daemon rhapsod
journalctl -u rhapsod -n 100 --no-pager
```

El servicio usa `scripts/yt-dlp-daemon.py`, el paquete Python `yt-dlp[default]` y complementos opcionales. Escucha por defecto en `127.0.0.1:8765`; configurar `RHAPSOD_YTDLP_DAEMON_URL=http://127.0.0.1:8765`. El bot utiliza el ejecutable si el servicio no está disponible. Establecer `RHAPSOD_MAX_CONCURRENT_YTDLP_JOBS` entre 1 y 4 solo para sustituir el valor adaptable a CPU.

## Acceso al panel y comprobación de reposo

```bash
ssh -N -L 8080:127.0.0.1:8080 user@host
```

Abrir `http://127.0.0.1:8080`. Antes de reiniciar, consultar el estado autenticado desde el servidor o mediante el túnel; curl solicita la contraseña:

```bash
curl --fail --user admin http://127.0.0.1:8080/api/state
```

Esperar a que `playerState` sea `idle`. Los estados de pausa y carga también indican uso activo. Si el panel está desactivado, coordinar una ventana de reposo con los usuarios y comprobar `!np`.

## Respaldo, actualización y reversión

Registrar el commit actual con `git rev-parse HEAD`. Durante una ventana de mantenimiento en reposo, detener el bot y respaldar las rutas reales de datos y configuración:

```bash
sudo systemctl stop rhapsod
sudo tar -czf /root/rhapsod-backup.tar.gz /var/lib/rhapsod /etc/rhapsod.env
```

Para el instalador, usar `/home/rhapsod/rhapsod/data`, `/home/rhapsod/rhapsod/.env` y el archivo de cookies configurado. Guardar las copias de forma privada.

En instalaciones por etiqueta, sustituir `<release-tag>` por la versión publicada elegida:

```bash
git fetch --tags origin
git checkout --detach <release-tag>
npm ci
npm run build
sudo systemctl restart rhapsod-ytdlp-daemon rhapsod
```

Si el despliegue sigue `main`, usar `git pull --ff-only` en lugar del checkout. Revisar primero las notas, especialmente al cambiar de versión mayor. No usar el instalador como mecanismo habitual de actualización.

Verificar `systemctl is-active rhapsod`, versión del panel, una pista de prueba, avance de cola y preferencias. Revisar errores con `journalctl -u rhapsod -n 100 --no-pager`. Para revertir, detener en reposo, recuperar el commit registrado, ejecutar `npm ci` y `npm run build`, restaurar el respaldo correspondiente si lo exige una migración e iniciar de nuevo.

## Docker Compose (Linux)

Compose inicia contenedores separados para el bot y yt-dlp con la red del host Linux. Ambos servicios escuchan en localhost; no se publica ningún puerto del panel. Esta configuración permite acceder a TeamSpeak o servicios auxiliares del host.

Preparar `.env` con rutas del contenedor:

```dotenv
RHAPSOD_DATA_DIR=/app/data
RHAPSOD_YTDLP_PATH=yt-dlp
RHAPSOD_FFMPEG_PATH=/usr/bin/ffmpeg
RHAPSOD_FFPROBE_PATH=/usr/bin/ffprobe
RHAPSOD_YTDLP_COOKIES_PATH=/app/data/youtube-cookies.txt
```

Crear `data/` y colocar las cookies si son necesarias. El bot monta datos con escritura; el servicio los lee sin modificarlos. `.env` se monta para el panel; recrear contenedores tras cambiar el entorno, ya que Compose lo inyecta al crearlos. Configurar servicios WARP/POT opcionales por separado en el host.

```bash
docker compose config --quiet
docker compose up -d --build
docker compose logs --tail=100 rhapsod ytdlp
```

Para actualizar, comprobar reposo, respaldar datos, obtener la revisión elegida y ejecutar `docker compose up -d --build --force-recreate`. La imagen instala Python en un entorno virtual y excluye dependencias npm de desarrollo en ejecución.

## Varias instancias

`RHAPSOD_INSTANCE_ID=blue` mueve los archivos persistentes a `<RHAPSOD_DATA_DIR>/instances/blue/`. Cada proceso necesita identificador, identidad TeamSpeak y puerto de panel propios. No compartir un directorio de instancia entre procesos.

```bash
sudo cp deploy/systemd/rhapsod@.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rhapsod@blue
```

Crear primero `/etc/rhapsod-blue.env` y revisar las rutas de la plantilla. La unidad define el identificador desde su nombre. Varias instancias pueden compartir un servicio yt-dlp. Un nombre o identidad duplicados al conectar causan salida 42; revisar registros antes de repetir el inicio.
