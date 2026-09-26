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

El instalador crea unidades adaptadas a sus rutas. Los ejemplos manuales están en `deploy/systemd/`; revisar usuario, directorio de trabajo, ejecutables y dependencias antes de copiarlos. La unidad del bot solicita el servicio opcional (`Wants=`): lo inicia si existe y sigue funcionando con el ejecutable si el servicio se detiene.

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

Las unidades aíslan parámetros del kernel, dispositivos, espacios de nombres y capacidades, y filtran las llamadas al sistema a `@system-service`; el acceso a archivos no se restringe. Revisar el resultado con `systemd-analyze security rhapsod`. Si un servicio registra `Operation not permitted` después de actualizar, buscar la llamada bloqueada en `journalctl` antes de flexibilizar la unidad con `sudo systemctl edit`.

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

`scripts/deploy.sh` ejecuta en el servidor todo el procedimiento siguiente con un solo comando: espera a que el panel indique `playerState: "idle"`, detiene el bot, respalda `data/` y el archivo de entorno, obtiene la revisión elegida, ejecuta `npm ci` y la compilación con el usuario del servicio, inicia el bot y espera a que siga activo y el panel responda. Si la compilación o el inicio fallan, vuelve al commit anterior, lo compila, lo inicia y termina con error. Reinicia el servicio de yt-dlp solo si cambió su script y avisa si cambiaron las plantillas de unidades.

```bash
sudo bash scripts/deploy.sh --dry-run
sudo bash scripts/deploy.sh
sudo bash scripts/deploy.sh --ref v4.0.0
```

El destino por defecto es `origin/main`; `--ref` acepta una rama, una etiqueta o un commit. La comprobación de reposo lee la configuración del panel de `APP_DIR/.env` (`--env-file` para `/etc/rhapsod.env`); sin un panel activo no reinicia salvo con `--force`. Los respaldos se guardan en `APP_DIR/../backups` (`--backup-dir`), solo legibles por root, y se conservan los cinco más recientes (`--keep`). Las rutas son relativas, así que para restaurar `data/` y `.env` se usa `tar -xzf <respaldo> -C /home/rhapsod/rhapsod`. No restaura datos al revertir; usar el respaldo indicado si una migración de datos lo requiere. `--service rhapsod@blue` actualiza una instancia con nombre.

El procedimiento manual:

Registrar el commit actual con `git rev-parse HEAD`. Durante una ventana de mantenimiento en reposo, detener el bot y respaldar las rutas reales de datos y configuración:

```bash
sudo systemctl stop rhapsod
sudo tar -czf /root/rhapsod-backup.tar.gz /var/lib/rhapsod /etc/rhapsod.env
```

Para el instalador, usar `/home/rhapsod/rhapsod/data`, `/home/rhapsod/rhapsod/.env` y el archivo de cookies configurado. Guardar las copias de forma privada: contienen datos de cada usuario, descritos en [datos y privacidad](privacy.es.md).

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

Si un archivo de datos (listas, favoritos, historial de escucha, biblioteca de canciones, telemetría o estado de reproducción) no se puede leer al iniciar porque no es JSON válido o tiene una versión de formato desconocida, el bot lo renombra a `<nombre>.corrupt-<hora UTC>` en el mismo directorio, registra una advertencia con ambos nombres y ese almacén arranca vacío. No se borra nada. Los archivos apartados se listan con `ls /var/lib/rhapsod/*.corrupt-*`. Para recuperar uno, detener el bot en reposo, reparar la copia o tomar el archivo del respaldo, devolverle su nombre original e iniciar el bot.

## Indicadores de reproducción

Cada pista terminada registra una línea `Playback session` con su latencia: `startDelayMs` (desde que se elige la pista hasta su primer cuadro de audio), `handoffGapMs` (silencio después de la pista anterior, ausente si el bot estuvo en reposo), `coldStart`, `prewarmed`, cortes y recargas del búfer. Para resumirlos desde el directorio de registros:

```bash
cd /var/lib/rhapsod
node /home/rhapsod/rhapsod/scripts/log-stats.mjs --since 2026-09-01T00:00:00Z logs/*.log
```

El bloque "Indicadores de reproducción" informa p50, p90 y p99 del tiempo desde un comando hasta el primer audio en un arranque en frío, de la pausa entre pistas y de los cortes por pista, además de la proporción de cambios que usaron el flujo precargado. Comparar la misma ventana antes y después de una actualización.

El panel también expone en vivo los mismos contadores e histogramas de latencia en `GET /api/metrics`, en formato de texto de Prometheus, detrás de la autenticación básica del panel y su enlace local. Un Prometheus en el mismo servidor lo consulta con:

```yaml
scrape_configs:
  - job_name: rhapsod
    metrics_path: /api/metrics
    basic_auth:
      username: admin
      password_file: /etc/prometheus/rhapsod-panel-password
    static_configs:
      - targets: ["127.0.0.1:8080"]
```

`rhapsod_play_start_delay_seconds` y `rhapsod_handoff_gap_seconds` son histogramas; `rhapsod_plays_total{reason="error"}` y `rhapsod_underruns_total` son contadores. Los contadores vuelven a cero cuando el bot se reinicia.

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

Crear `data/` y colocar las cookies si son necesarias. El bot monta datos con escritura; el servicio los lee sin modificarlos. `.env` se monta para el panel; recrear contenedores tras cambiar el entorno, ya que Compose lo inyecta al crearlos.

Los contenedores se ejecutan con el usuario sin privilegios `node` (uid 1000). Dar permisos de escritura a ese uid sobre los archivos montados:

```bash
sudo chown -R 1000:1000 data .env
```

Compose también inicia el proveedor POT de bgutil, escuchando en `127.0.0.1:4416` y con la misma versión que el complemento de la imagen. WARP sigue siendo un servicio del host.

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
