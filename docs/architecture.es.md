# Arquitectura

[English](architecture.md)

Rhapsod es una aplicación Node.js ESM. `src/main.ts` conecta configuración, persistencia, proveedores, reproducción, comandos, adaptador TeamSpeak y panel Hono opcional.

```text
Chat TeamSpeak / panel local
             |
Registro de comandos, permisos y límites
             |
Servicio -> TrackQueue -> PlaybackController
             |                  |
Proveedores -> PreparedAudioStore -> FFmpeg PCM
                                    |
                           Opus / temporizador de tramas
                                    |
                           Adaptador de voz TeamSpeak
```

## Límites entre módulos

- `src/application/`: solicitudes, propiedad de cola, controlador, épocas de validez, URL preparadas, listas, preferencias e historial.
- `src/audio/`: FFmpeg, búfer PCM, perfiles de volumen, efectos, Opus y temporización.
- `src/media/`: metadatos, resolución de URL, búsqueda, clasificación, radio y letras.
- `src/adapters/ts3/`: conexión, reconexión, permisos de voz, identidad y pruebas de conexión.
- `src/commands/`: metadatos de comandos, controladores, permisos y respuestas.
- `src/panel/`: endpoints locales autenticados, plantillas y edición del entorno.
- `src/observability/`: registros estructurados, métricas y errores sin secretos.
- `src/config.ts`: esquema de ejecución y valores predeterminados.
- `src/bootstrap/`: partes del arranque que `src/main.ts` conecta en orden: salida y manejo de fallos (`exit.ts`), modo de configuración (`setup-mode.ts`), los almacenes JSON y su guardado (`stores.ts`), la sincronización de la vista del servidor del panel (`server-view.ts`), la admisión de comandos del chat (`chat-commands.ts`: límite de comandos simultáneos, límite por usuario y control de permiso para hablar), el ciclo de reconexión a TeamSpeak (`reconnect.ts`: 5 intentos con esperas de 5 a 80 s, luego guardar y salir con 1), la conexión del panel en modo completo (`panel.ts`: estado, métricas y comandos ejecutados como administrador del panel), los avisos del servicio de reproducción (`playback-events.ts`: registros, historial, biblioteca de canciones, métricas y anuncios en el chat) y opciones compartidas de yt-dlp.

## Comandos

Un comando está en tres lugares, todos indexados por su nombre: la forma de sus argumentos en la unión `ChatCommand` (`src/commands/chat-command.ts`), una entrada en `COMMANDS` (`src/commands/command-registry.ts`) con alias, categoría, uso, resumen y analizador de argumentos, y un manejador en `COMMAND_HANDLERS` (`src/commands/command-handlers.ts`). `!help` y `GET /api/commands` leen `COMMANDS`. Si falta un comando en alguna de las tablas, o un analizador devuelve la forma de otro comando, `npm run typecheck` falla. Los manejadores van en su propia tabla porque necesitan el servicio de reproducción y la conexión de TeamSpeak, mientras que el analizador y `!help` se cargan sin ellos.

## Reproducción y proveedores

Los metadatos se resuelven al recibir solicitudes; las URL temporales se preparan cerca de la reproducción. `PreparedAudioStore` evita consultas duplicadas y gestiona caducidad y cancelación. `PlaybackEpoch` invalida trabajo asíncrono antiguo tras acciones de transporte. `PlaybackController` serializa el avance y limita el tiempo de resolución.

YouTube usa Innertube y yt-dlp, opcionalmente mediante un servicio Python persistente. SoundCloud usa su interfaz web pública con alternativas de resolución. Spotify proporciona solo metadatos; SongLink vincula enlaces a fuentes disponibles. El audio directo admite entradas HTTPS públicas. Las comprobaciones rechazan direcciones privadas y validan DNS al conectar.

FFmpeg produce PCM estéreo de 48 kHz. Opus codifica tramas de 20 ms dentro de 497 bytes de audio; el códec de red TS3 es Opus Music (5). La temporización utiliza plazos monotónicos y envía silencio durante falta de datos. La preparación anticipada crea el siguiente flujo FFmpeg y perfil de volumen antes de la transición.

## Persistencia y personalización

El estado reside en `RHAPSOD_DATA_DIR`, opcionalmente separado por `RHAPSOD_INSTANCE_ID`. Los almacenes JSON usan reemplazo mediante archivo temporal y escrituras serializadas o agrupadas. El cierre espera escrituras pendientes. Los almacenes sin usar o de solo lectura no deben sobrescribir datos al cerrar.

El historial proporciona estadísticas personales y globales y señales para la reproducción automática; las estadísticas globales solo cuentan pedidos de personas, más los saltos de pistas elegidas por la reproducción automática. El peso de sesión caduca con la inactividad y las escuchas antiguas pierden peso. Los límites de pistas se aplican en memoria y disco. La energía deducida del título es una estimación de clasificación, no un análisis del audio.

## Administración

El panel permanece en `127.0.0.1` con autenticación básica y acceso por SSH. Edita solo ajustes permitidos y guarda cookies localmente cuando se solicita. Los secretos existen en archivos de ejecución locales; registros y respuestas deben ocultarlos. El modo inicial de panel no conecta el bot a TeamSpeak.

El código del panel que corre en el navegador está en `src/panel/scripts/*.js`: scripts clásicos que comparten un único ámbito global por página y que `panelScript()` incluye en línea en cada página, porque la CSP solo permite scripts en línea. `npm run typecheck` los revisa con `tsc -p tsconfig.panel.json` (tipos del DOM, `checkJs`), `npm run lint` les aplica ESLint y `npm run build` los copia a `dist/panel/scripts`. `tests/panel-scripts.test.ts` falla cuando un manejador en línea de una página (`onclick="nombre(..."`) usa una función que sus scripts no definen. Las páginas que todavía no se movieron conservan su script en `src/panel/panel-templates.ts`.

## Verificación y ampliación

Ejecutar `npm run check` y `npm run test:coverage`. Las pruebas de proveedores y TeamSpeak usan sustitutos controlados; comprobar audio y despliegue en el entorno de destino. TeamSpeak 6 está previsto y debe conservar el contrato de conexión de la aplicación.

`npm run build && npm run smoke` inicia `dist/main.js` en modo de configuración (panel activo, conexión automática a TeamSpeak desactivada) con un directorio de datos temporal, una contraseña del panel aleatoria y un puerto libre. Comprueba que el panel responde, rechaza solicitudes sin credenciales, sirve `/api/state` y el tablero, y que el proceso termina con código 0 ante SIGTERM. `npm run smoke -- --source` ejecuta `src/main.ts` en su lugar; las pruebas usan esa variante. Si algo falla, muestra la última salida del bot.

Los cambios en el ranking de búsqueda se miden con `npm run eval:search`, que puntúa `src/media/youtube/search-ranking.ts` contra `tests/fixtures/search-eval.json`: cada caso tiene una búsqueda, la lista de candidatos que vio el ranking y las elecciones aceptables. Las pruebas fallan cuando la precisión baja del `minAccuracy` del archivo; una mejora del ranking sube ese número en el mismo PR. Para agregar casos reales, ejecutar `npm run eval:search -- --record "<búsqueda>"` en un equipo con acceso a YouTube, completar `expected` a mano y agregar el resultado al archivo con `"source": "recorded"`.

Los cambios en la reproducción automática se miden con `npm run eval:autoplay`, que ejecuta la rotación del DJ del servicio de reproducción real durante 40 elecciones sobre `tests/fixtures/autoplay-eval.json` (pistas, sus mixes de YouTube y un historial de escucha inicial) con una semilla aleatoria fija. Informa repeticiones dentro de 20 reproducciones, la mayor proporción de un mismo artista en 10 elecciones seguidas, el salto medio de energía entre títulos consecutivos y la proporción de elecciones nuevas para el canal. Las pruebas verifican tres semillas contra los `limits` del archivo.
