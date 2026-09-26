# Plan de trabajo

[English](roadmap.md)

La próxima versión es 4.0.0. El comportamiento publicado se registra en [versiones](releases.es.md); los cambios pendientes corresponden a [notas sin publicar](releases/unreleased.es.md). Los perfiles 1.x, 2.x y 3.x se conservan como referencia histórica.

## Entregado

- Colas compartidas, listas guardadas y estado persistente.
- Panel local, asistente y herramientas de despliegue.
- Favoritos por usuario, fuente preferida, estadísticas y reproducción automática como DJ (pistas similares, clásicos del canal, descubrimientos).
- Búsqueda de radio, títulos en directo, directorios por instancia y detección de duplicados.
- Módulos de cola y controlador separados, URL preparadas, épocas de cancelación y esperas limitadas.
- Control de salida para ffmpeg y ffprobe, cuarentena de archivos de datos ilegibles y escrituras agrupadas.

## Trabajo planificado (propuesta, abierta a veto)

Los puntos están ordenados por impacto visible para los usuarios dividido por riesgo. Cada uno se entrega en su propio PR con una prueba de regresión, documentación bilingüe y notas sin publicar. Primero se mide, para que los ajustes posteriores muestren un antes y un después. Para quitar o reordenar un punto, comentar en el PR de este plan; nada de lo siguiente empieza hasta que el plan se integre.

### Fase 1: medir

1. **Indicadores de reproducción.** Registrar por pista: tiempo desde el comando en el chat hasta el primer cuadro de audio, pausa entre el final de una pista y el inicio de la siguiente, cortes y recargas del búfer, y si la pista siguiente estaba precargada. Ampliar `scripts/log-stats.mjs` con un informe (p50/p90/p99 por indicador). Impacto: cada cambio posterior de reproducción tiene un número. Riesgo: bajo, solo registros. Archivos: `playback-controller.ts`, `main.ts`, `scripts/log-stats.mjs`.
2. **Endpoint de métricas.** `GET /api/metrics` en el panel en formato de texto de Prometheus (contadores e histogramas de los indicadores anteriores), con la autenticación y el enlace local actuales. Impacto: paneles y alertas sin leer registros. Riesgo: bajo. Archivos: `panel-server.ts` (acordado con el carril A: solo rutas, el middleware de autenticación no cambia), `observability/metrics.ts`.

### Fase 2: reproducción

3. **Recuperar un flujo detenido a mitad de canción.** Hoy un origen detenido termina la pista como error y la salta. Reiniciar ffmpeg una vez en la posición actual, como ya hace el reintento ante un 403, antes de abandonarla. Prueba de regresión: un flujo que se detiene a la mitad se reanuda en vez de saltarse. Riesgo: bajo a medio, reutiliza la reanudación existente.
4. **Ciclo de vida de URL según su vencimiento.** Las URL de googlevideo preparadas y en caché llevan un `expire` firmado. Renovar una URL preparada que vence dentro de la duración de la pista siguiente más un margen, antes del cambio de pista y no después de un 403. Riesgo: medio. Archivos: `prepared-audio-store.ts`, `audio-url-cache.ts`.
5. **Ajuste del cambio sin pausa.** Con las pausas medidas en el punto 1, ajustar cuándo se precarga la pista siguiente y conservar el flujo precargado ante saltos de posición y ediciones de la cola que no cambian la pista siguiente. El objetivo y el alcance dependen de los datos de la fase 1; se omite si la pausa ya es menor a 200 ms en p90. Riesgo: medio.
6. **Revisión del volumen.** Informar la dispersión del volumen medido por sesión a partir del perfilador de volumen y ajustar el objetivo por defecto o el camino alternativo solo si la diferencia es audible. Riesgo: bajo.

### Fase 3: calidad de búsqueda y reproducción automática

7. **Evaluación de búsqueda sin conexión.** `scripts/search-eval.mjs` más un conjunto de listas de candidatos grabadas para al menos 50 búsquedas reales (versiones, en vivo, videos con letra, artista y título invertidos, títulos en español e inglés) con la elección esperada. Puntúa `search-ranking.ts` y corre como prueba que falla ante una regresión. Los cambios de ranking posteriores se integran con la diferencia de puntaje. Riesgo: bajo, herramienta.
8. **Evaluación de la reproducción automática.** Un arnés que ejecuta la rotación del DJ durante muchos turnos sobre listas relacionadas grabadas e historiales sintéticos, e informa repeticiones dentro de una ventana, la mayor proporción de un mismo artista y los saltos de energía entre elecciones seguidas. Los ajustes siguen la misma regla de antes y después. Riesgo: bajo.

### Fase 4: experiencia en el chat

9. **Módulo central de mensajes.** Mover los 56 textos literales del chat en `command-handlers.ts` y los del controlador a `lib/messages.ts`, con un tono uniforme y listos para un segundo idioma. Riesgo: bajo, cubierto por las pruebas de los manejadores.
10. **Mejor `!help`.** Ahora que los mensajes largos se dividen, `!help` muestra una categoría por página con un pie que indica la siguiente, y `!help <comando>` explica un solo comando con sus alias. Riesgo: bajo.
11. **Votación opcional para saltar.** `RHAPSOD_VOTE_SKIP` (desactivado por defecto): cuando alguien que no pidió la pista envía `!skip`, cuenta como voto, y la pista se salta cuando votó más de la mitad de los oyentes del canal del bot. Necesita un método de la conexión de TeamSpeak que liste los UID de los clientes comunes del canal del bot; lo agrega primero el carril A. Riesgo: medio.

### Fase 5: arquitectura y herramientas

12. **Tabla de registro de comandos.** Una entrada por comando con su especificación, su analizador y su manejador, en lugar del `switch` de análisis de `chat-command.ts` y el de despacho de `command-handlers.ts`. `!help` y la lista de comandos del panel leen la misma tabla. Riesgo: medio, toca todos los comandos; las pruebas actuales del analizador y los manejadores deben pasar sin cambios.
13. **Script de humo.** `scripts/smoke.mjs` compila, inicia el bot en modo de configuración con un directorio de datos temporal, consulta los endpoints de salud y estado del panel y lo detiene. Corre en CI. Riesgo: bajo.
14. **Dividir `main.ts`.** Extraer la inicialización en módulos con pruebas: almacenamiento, reproducción, panel y apagado. `main.ts` conserva solo el orden de arranque. Riesgo: medio; se hace después de los puntos 12 y 13 para que el script de humo lo proteja.
15. **Scripts del panel como archivos reales.** Sacar el JavaScript en línea del panel de las cadenas de plantilla a archivos que revisen ESLint y `tsc`, servidos en línea igual que ahora para mantener la CSP actual. Riesgo: medio, el panel es grande; va al final de esta fase.
16. **Servidor TeamSpeak simulado (carril A).** Un servidor con guion o datos grabados para ejercitar el adaptador de TeamSpeak y la inicialización sin un servidor real. Corresponde a `src/adapters/ts3/`; lo toma la sesión del carril A.

### Propuestos por el carril A (abiertos a veto)

18. **Aplicación de escritorio para Windows.** `tools/desktop` (C#, WinForms y WebView2): gestor del túnel SSH, panel integrado, estado en la bandeja del sistema, reinicio y actualización seguros. Inicia sesión con tokens del panel de corta duración emitidos por SSH en lugar de una contraseña guardada en el programa. El soporte de tokens cambia la autenticación del panel después de que se integre el punto 2.
19. **Script de despliegue.** `scripts/deploy.sh`: esperar a que no suene nada, respaldar, actualizar, compilar, reiniciar y volver atrás si la nueva compilación no arranca.
20. **Refuerzo de CI.** `systemd-analyze verify` para las unidades, `shellcheck` para los scripts, un runner de Windows y acciones fijadas por SHA de commit.

### Solo propuesta: almacenamiento

17. **SQLite.** Recomendación: mantener por ahora los almacenes en JSON. Desde #104 y #113, los archivos ilegibles se ponen en cuarentena y las escrituras se agrupan, y el almacén más grande, el historial de escucha, tiene un límite de 50.000 entradas por usuario. `node:sqlite` sigue siendo experimental en Node 22, la versión mínima admitida. Volver a evaluarlo cuando un almacén necesite consultas que los archivos JSON no resuelven, o cuando el historial supere unos 20 MB. Una migración importaría cada archivo JSON una vez al iniciar en una sola base, conservaría el JSON como respaldo y saldría como versión mayor.

## Funciones abiertas

- [Adaptador TeamSpeak 6 (#12)](https://github.com/Juanzaan/rhapsod/issues/12): implementar y verificar voz y chat mediante el contrato existente.
- [Anuncios de bienvenida (#21)](https://github.com/Juanzaan/rhapsod/issues/21): definir entradas al canal y audio opcional sin interrumpir la música.

No hay una fecha de publicación comprometida. Las incidencias deben definir criterios de aceptación antes de implementar.

## Prioridades de mantenimiento

- Mantener coherencia entre requisitos, archivos de bloqueo, instalador y contenedores.
- Probar reconexión y permisos de voz con servidores TeamSpeak reales además de pruebas simuladas.
- Validar cambios de proveedores mediante solicitudes limitadas y errores visibles.
- Mantener documentación equivalente en inglés y español y notas revisadas por versión.

## Restricciones

Spotify proporciona solo metadatos. No se elude DRM. El panel permanece autenticado y local. La personalización debe respetar propiedad de cola, control del usuario y comportamiento predecible al detener.
