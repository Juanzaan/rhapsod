# Datos y privacidad

[English](privacy.md)

Rhapsod guarda lo que sabe de los usuarios de TeamSpeak en archivos JSON dentro de `RHAPSOD_DATA_DIR` (`/var/lib/rhapsod` con systemd, `/home/rhapsod/rhapsod/data` con el instalador, `<RHAPSOD_DATA_DIR>/instances/<id>/` con `RHAPSOD_INSTANCE_ID`). Nada sale del servidor: no hay servicio de analítica. Cada usuario se identifica por su identificador único de TeamSpeak (UID).

## Qué se guarda de cada usuario

| Archivo                  | Por UID                                                                                                                                                                                                        | Límite                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `user-telemetry.json`    | Todos los apodos vistos, ID de grupos del servidor, mayor talk power, primera y última vez visto, ID del último canal, cantidad de comandos enviados, veces que movió al bot, veces que entró al canal del bot | Ninguno: una entrada por cada UID visto, que se conserva hasta borrarla a mano |
| `listening-history.json` | Por pista: reproducciones, escuchas completas, saltos, última reproducción; la lista de reproducciones con hora y si terminaron                                                                                | 50.000 pistas y 50.000 reproducciones por usuario; se descartan las más viejas |
| `user-preferences.json`  | Favoritos y la fuente de búsqueda preferida                                                                                                                                                                    | 50 favoritos                                                                   |
| `playlists.json`         | Listas guardadas                                                                                                                                                                                               | 20 listas de 200 pistas                                                        |
| `state.json`             | Apodo y UID de quien pidió cada pista de la cola actual                                                                                                                                                        | Solo la cola del último guardado                                               |

Archivos sin datos de usuarios: `song-library.json` (cada pista que sonó, sin quién la pidió), `audio-url-cache.json`, `soundcloud-client-id.json` y `ts3-identity.txt`, la identidad del propio bot. Los conteos globales de `listening-history.json` (usados por `!tops` y el autoplay) no llevan UID.

## Registros y memoria

Cada comando del chat queda registrado con su texto, el apodo y el UID de quien lo envió. Los registros están en `<RHAPSOD_DATA_DIR>/logs/` y se borran después de `RHAPSOD_LOG_RETENTION_DAYS` días (14 por defecto, rango 1-90). Con systemd, el journal guarda su propia copia de la salida del servicio según la retención del sistema.

La vista de chat del panel conserva los últimos 50 mensajes del canal solo en memoria; un reinicio los borra.

## Borrar los datos de un usuario

1. Buscar el UID a partir de un apodo que el bot haya visto:

   ```bash
   cd /var/lib/rhapsod
   sudo -u rhapsod node -e '
   const users = require("./user-telemetry.json").users;
   for (const user of Object.values(users))
     if (user.names.includes(process.argv[1])) console.log(user.uid);
   ' 'Nickname'
   ```

2. Esperar a que no suene nada (`/api/state` indica `playerState: "idle"`) y detener el bot:

   ```bash
   sudo systemctl stop rhapsod
   ```

3. Quitar el UID de cada archivo que lo guarda. Reemplazar `UID_HERE` y ejecutar como el usuario del servicio desde el directorio de datos:

   ```bash
   sudo -u rhapsod node -e '
   const fs = require("node:fs");
   const uid = process.argv[1];
   const edits = {
     "user-telemetry.json": (d) => delete d.users?.[uid],
     "listening-history.json": (d) => delete d.users?.[uid],
     "user-preferences.json": (d) => delete d.users?.[uid],
     "playlists.json": (d) => delete d.playlists?.[uid],
   };
   for (const [file, edit] of Object.entries(edits)) {
     if (!fs.existsSync(file)) continue;
     const data = JSON.parse(fs.readFileSync(file, "utf8"));
     edit(data);
     fs.writeFileSync(file, JSON.stringify(data));
     console.log(`updated ${file}`);
   }
   ' 'UID_HERE'
   ```

4. Comprobar que ningún archivo nombra el UID; cada conteo tiene que ser `0`:

   ```bash
   grep -c 'UID_HERE' user-telemetry.json listening-history.json user-preferences.json playlists.json
   ```

5. Quitar las líneas de registro que nombran el UID, o esperar a que la retención las elimine: `grep -l 'UID_HERE' logs/*` lista los archivos.
6. Iniciar el bot: `sudo systemctl start rhapsod`.

`state.json` no se edita: solo contiene la cola actual, y el nombre del usuario sale de ahí a medida que esas pistas suenan o se quitan. Las copias de seguridad hechas antes del borrado siguen conteniendo los datos; consultar [despliegue](deployment.es.md) para saber dónde se guardan. Para borrar todo de todos los usuarios, detener el bot y eliminar los cinco archivos de la tabla.

## Verificación

Después del reinicio, `journalctl -u rhapsod -n 50 --no-pager` no muestra el aviso `set aside` para los archivos editados; una edición mal hecha se habría movido a `<nombre>.corrupt-<hora>`. El usuario vuelve a tener una entrada de telemetría la próxima vez que el bot lo vea en el servidor.
