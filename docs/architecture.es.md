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

## Reproducción y proveedores

Los metadatos se resuelven al recibir solicitudes; las URL temporales se preparan cerca de la reproducción. `PreparedAudioStore` evita consultas duplicadas y gestiona caducidad y cancelación. `PlaybackEpoch` invalida trabajo asíncrono antiguo tras acciones de transporte. `PlaybackController` serializa el avance y limita el tiempo de resolución.

YouTube usa Innertube y yt-dlp, opcionalmente mediante un servicio Python persistente. SoundCloud usa su interfaz web pública con alternativas de resolución. Spotify proporciona solo metadatos; SongLink vincula enlaces a fuentes disponibles. El audio directo admite entradas HTTPS públicas. Las comprobaciones rechazan direcciones privadas y validan DNS al conectar.

FFmpeg produce PCM estéreo de 48 kHz. Opus codifica tramas de 20 ms dentro de 497 bytes de audio; el códec de red TS3 es Opus Music (5). La temporización utiliza plazos monotónicos y envía silencio durante falta de datos. La preparación anticipada crea el siguiente flujo FFmpeg y perfil de volumen antes de la transición.

## Persistencia y personalización

El estado reside en `RHAPSOD_DATA_DIR`, opcionalmente separado por `RHAPSOD_INSTANCE_ID`. Los almacenes JSON usan reemplazo mediante archivo temporal y escrituras serializadas o agrupadas. El cierre espera escrituras pendientes. Los almacenes sin usar o de solo lectura no deben sobrescribir datos al cerrar.

El historial proporciona estadísticas personales y globales y señales para la reproducción automática. El peso de sesión caduca con la inactividad y las escuchas antiguas pierden peso. Los límites de pistas se aplican en memoria y disco. La energía deducida del título es una estimación de clasificación, no un análisis del audio.

## Administración

El panel permanece en `127.0.0.1` con autenticación básica y acceso por SSH. Edita solo ajustes permitidos y guarda cookies localmente cuando se solicita. Los secretos existen en archivos de ejecución locales; registros y respuestas deben ocultarlos. El modo inicial de panel no conecta el bot a TeamSpeak.

## Verificación y ampliación

Ejecutar `npm run check` y `npm run test:coverage`. Las pruebas de proveedores y TeamSpeak usan sustitutos controlados; comprobar audio y despliegue en el entorno de destino. TeamSpeak 6 está previsto y debe conservar el contrato de conexión de la aplicación.
