# Instalación

[English](install.md)

Usar un servidor Linux permanente con acceso UDP saliente a TeamSpeak. El instalador admite x86_64 y aarch64 (arm64, por ejemplo Oracle Cloud Ampere) con Ubuntu 20.04+, Debian 11+ y sistemas de la familia RHEL 9+. El consumo depende de la cola y la concurrencia de extracción; medir memoria de FFmpeg y yt-dlp junto con Node.

## Instalador para VPS

```bash
curl -fsSL https://raw.githubusercontent.com/Juanzaan/rhapsod/main/install.sh | sudo bash
```

El instalador selecciona la última etiqueta estable, instala Node 22 si falta, yt-dlp, FFmpeg, el servicio Python y servicios auxiliares opcionales, y crea unidades systemd. Una instalación existente de Node debe ser >=22.19.0. Las instalaciones nuevas reciben `.env`, un archivo de cookies vacío y una contraseña generada; repetir el instalador conserva configuración y cookies.

Las descargas se comprueban con las sumas que publica cada proyecto: `SHASUMS256.txt` para Node.js, `SHA2-256SUMS` para yt-dlp y el archivo MD5 del espejo de FFmpeg. Una diferencia detiene la instalación; la actualización semanal de yt-dlp conserva el binario instalado. El servidor POT y su complemento de yt-dlp usan la misma versión fijada. Un usuario de servicio nuevo recibe el shell `nologin`; ejecutar las tareas de mantenimiento con `sudo -u rhapsod <comando>`.

En una instalación nueva, el instalador primero pregunta por el servidor de TeamSpeak (`ts.example.com` o `ts.example.com:9987`) y su contraseña, si tiene. La pregunta aparece en la terminal, así que también funciona con `curl | sudo bash`. Al terminar, el bot entra a ese servidor y el instalador muestra un código de un solo uso:

```text
The bot is in your TeamSpeak server.
Make yourself its admin: in TeamSpeak, send the bot or its channel
  !claim abcde-fghjk
```

Enviar `!claim <código>` en TeamSpeak. El primer usuario que envía el código correcto queda como administrador: el bot agrega su UID a `RHAPSOD_ADMIN_UIDS` en `.env`. El código se guarda en `data/admin-claim-code` hasta que se usa, se conserva entre reinicios y deja de funcionar tras cinco intentos incorrectos hasta el siguiente reinicio. Si ya hay un administrador configurado, `!claim` se rechaza.

Presionar Enter en la pregunta, o ejecutar sin terminal, mantiene el comportamiento anterior: el bot inicia solo el panel con `RHAPSOD_TS3_AUTO_CONNECT=false` y TeamSpeak se configura en el panel. Para configurarlo sin la pregunta, pasar la respuesta:

```bash
curl -fsSL https://raw.githubusercontent.com/Juanzaan/rhapsod/main/install.sh -o "$HOME/rhapsod-install.sh"
sudo env RHAPSOD_TS3_HOST=ts.example.com:9987 RHAPSOD_TS3_PASSWORD=secreto bash "$HOME/rhapsod-install.sh"
```

Una contraseña con espacios, `#` o comillas no puede pasar por el instalador; configurarla en el panel.

Después de eso el panel es opcional. Abrir un túnel desde la computadora propia:

```bash
ssh -N -L 8080:127.0.0.1:8080 user@host
```

Abrir `http://127.0.0.1:8080/` (o `/setup` si TeamSpeak todavía no está configurado) y acceder con las credenciales mostradas. Mantener el panel en `127.0.0.1`.

Cloudflare WARP no se instala por defecto. Solo sirve cuando YouTube bloquea la dirección del servidor, algo que pasa con rangos de VPS en la nube y rara vez con una conexión hogareña. Cuando ocurre, `!stats` lo indica. Para agregar WARP, volver a ejecutar el instalador:

```bash
sudo env RHAPSOD_WITH_WARP=1 bash "$HOME/rhapsod-install.sh"
```

Luego reiniciar el servicio de yt-dlp y el bot cuando no haya nada sonando. Repetir el instalador conserva WARP si ya está instalado; `RHAPSOD_SKIP_WARP=1` lo deja afuera. Las otras opciones del instalador son `RHAPSOD_REF`, `RHAPSOD_REPOSITORY` (una URL de git o una ruta local, para forks y CI), `RHAPSOD_APP_DIR` y `RHAPSOD_USER`.

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

Sin `RHAPSOD_ADMIN_UIDS`, el bot escribe un código de `!claim` en `data/admin-claim-code` y lo registra en el log al iniciar; enviar `!claim <código>` en TeamSpeak para quedar como administrador.

Usar `RHAPSOD_YTDLP_PATH`, `RHAPSOD_FFMPEG_PATH` y `RHAPSOD_FFPROBE_PATH` si las herramientas no están en PATH. El servicio opcional escucha en `127.0.0.1:8765`; configurar `RHAPSOD_YTDLP_DAEMON_URL` solo si está ejecutándose. Consultar [despliegue](deployment.es.md) para servicios y Docker.

Las claves `RHAPSOD_YTDLP_*_TIMEOUT_MS` fijan los tiempos de espera de yt-dlp en milisegundos; `.env.example` muestra cada una con su valor por defecto y su rango permitido. El bot no inicia con un valor fuera de ese rango y el panel no permite guardarlo.

## Verificación

```bash
node --version
yt-dlp --version
ffmpeg -version
ffprobe -version
```

Confirmar que el bot entra en su canal, solicitar una pista con `!play` y revisar `!stats`. En instalaciones con el script, ejecutar `rhapsod doctor`: imprime una línea `ok`, `WARN` o `FAIL` por comprobación (servicios, Node.js, FFmpeg, yt-dlp, puertos del daemon y del POT, panel en loopback, TeamSpeak, YouTube, avisos abiertos, disco, reloj) y termina con código distinto de cero cuando falla alguna.

## El comando rhapsod

El instalador agrega `/usr/local/bin/rhapsod` y registra la instalación en `/etc/rhapsod/install.conf` (`APP_DIR`, `APP_USER`, `NODE_BIN`). Pide sudo una vez, porque el archivo de entorno pertenece al usuario del servicio.

| Comando             | Efecto                                                                                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rhapsod status`    | Estado de los servicios y del reproductor, conexión con TeamSpeak, un código de `!claim` pendiente y el comando del túnel SSH para el panel. `--json` para scripts.  |
| `rhapsod doctor`    | Las comprobaciones anteriores, con el arreglo de cada falla. No imprime secretos.                                                                                    |
| `rhapsod password`  | Escribe un `RHAPSOD_PANEL_PASSWORD` aleatorio nuevo y lo imprime.                                                                                                    |
| `rhapsod restart`   | Reinicia el bot cuando el reproductor está en espera; `--force` reinicia durante la reproducción.                                                                    |
| `rhapsod logs [N]`  | Sigue el journal del bot y del daemon desde N líneas atrás (100 por defecto).                                                                                        |
| `rhapsod version`   | Versión instalada.                                                                                                                                                   |
| `rhapsod backup`    | Detiene el bot unos segundos y archiva `data/` y `.env` en `/home/rhapsod/backups`. Se niega durante la reproducción salvo con `--force`.                            |
| `rhapsod update`    | Hace un backup, instala la última versión publicada (o `--ref REF`), espera a que el bot arranque sano y vuelve atrás solo si no arranca.                            |
| `rhapsod rollback`  | Reinstala la versión que reemplazó el último `update`. Un segundo `rollback` vuelve hacia adelante.                                                                  |
| `rhapsod uninstall` | Quita los servicios, la tarea de cron, `/etc/rhapsod` y el comando, después de un último backup. `--purge` también quita el usuario `rhapsod` y su carpeta personal. |

Sin el instalador (Docker, instalaciones manuales), las mismas comprobaciones se ejecutan desde el checkout: `node dist/cli.js status`, `doctor`, `password` o `version`, con `RHAPSOD_ENV_FILE` apuntando al archivo de entorno cuando no es `./.env`.

### Actualizaciones, backups y desinstalación

`rhapsod update` y `rollback` esperan a que no haya nada sonando; `backup` se niega durante la reproducción. `--force` omite esa comprobación. Los backups comparten carpeta con `scripts/deploy.sh`; se conservan los cinco más nuevos. Para restaurar uno:

```bash
sudo systemctl stop rhapsod
sudo tar -xzf /home/rhapsod/backups/rhapsod-<fecha>-<commit>.tar.gz -C /home/rhapsod/rhapsod
sudo systemctl start rhapsod
```

`update` reemplaza el código del bot, no las unidades de systemd ni los otros componentes. Cuando las notas de la versión indican que cambió el instalador, volver a ejecutar `install.sh`; conserva `.env` y los datos.

`rollback` restaura solo el código; los datos quedan como los dejó la versión más nueva. Si esa versión cambió el formato de los datos, restaurar el backup tomado antes de la actualización como se muestra arriba.

`rhapsod uninstall --purge --yes` se ejecuta sin preguntar. El último backup queda en `/var/backups/rhapsod`, porque `--purge` borra la carpeta personal. Node.js, FFmpeg, yt-dlp y WARP quedan instalados, porque otros programas pueden usarlos.

## Resolución de problemas

- Fallo de conexión: revisar host, puerto de voz, contraseñas y permisos. El asistente permite probar la conexión.
- Fallo de YouTube: actualizar yt-dlp según su método de instalación y revisar su estado en el panel. Si requiere autenticación, configurar cookies de una cuenta autorizada mediante el asistente o `RHAPSOD_YTDLP_COOKIES_PATH`.
- Fallo al guardar ajustes: `RHAPSOD_ENV_FILE` debe apuntar a un archivo escribible por el usuario del servicio. Para `/etc/rhapsod.env` con `ProtectSystem=full`, añadir `ReadWritePaths=/etc/rhapsod.env` en una modificación de systemd y ajustar la propiedad del archivo.
- Fallo de permisos de datos: el usuario del servicio debe ser propietario de `RHAPSOD_DATA_DIR` y poder crear archivos temporales junto a los JSON persistentes.

Tras modificar unidades, ejecutar `sudo systemctl daemon-reload`; esperar al reposo antes de reiniciar.
