[English](unreleased.md)

## Resumen

La normalización de volumen medida funciona por primera vez: los temas con un perfil de sonoridad suenan al nivel objetivo sin las variaciones de ganancia de la normalización en una sola pasada.

## Cambios

- El medidor de sonoridad nunca generaba un perfil: ffmpeg se ejecutaba con `-loglevel error`, que oculta el informe de loudnorm, el informe se leía de stdout en lugar de stderr y sus valores, impresos como texto, se rechazaban. Todos los temas con duración se reproducían con `loudnorm` dinámico en una sola pasada, y cada precarga repetía la medición de 120 segundos. Los temas medidos ahora reciben normalización en dos pasadas, lineal cuando la ganancia entra bajo el techo de -1,5 dBTP.
- Panel: todas las páginas usan el mismo marco de 1320 px, así que el menú ya no se corre al cambiar de página. Las tarjetas de una fila de la consola comparten el alto y la cola se desplaza dentro de su tarjeta; Configuración y Comandos muestran cada grupo a ancho completo, con una grilla pareja de campos y comandos.
- Panel: la página Servidor ya no reconstruye el árbol de canales cada 2,5 segundos cuando nada cambió, algo que cortaba las transiciones al pasar el puntero. Con el sistema en movimiento reducido solo se detienen el fondo y el tocadiscos; la respuesta a clics y al puntero se mantiene.
- Panel: los estados del reproductor se muestran en español (SONANDO, EN PAUSA, CARGANDO, EN ESPERA), y el asistente de instalación indica usar `!claim` para el primer administrador, con el campo de UIDs de administrador en una sección avanzada.

## Actualización

No se requieren acciones además de los pasos de actualización de v4.0.0. `RHAPSOD_LOUDNESS_TARGET_LUFS` mantiene su significado y su valor por defecto (-14).

## Verificación

Ejecutar `npm run check` y `npm run test:coverage`. En un equipo con ffmpeg, `npx vitest run tests/loudness-profiler.test.ts` además mide un tono generado con el binario real.
