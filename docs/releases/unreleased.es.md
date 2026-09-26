[English](unreleased.md)

## Resumen

La normalización de volumen medida funciona por primera vez: los temas con un perfil de sonoridad suenan al nivel objetivo sin las variaciones de ganancia de la normalización en una sola pasada.

## Cambios

- El medidor de sonoridad nunca generaba un perfil: ffmpeg se ejecutaba con `-loglevel error`, que oculta el informe de loudnorm, el informe se leía de stdout en lugar de stderr y sus valores, impresos como texto, se rechazaban. Todos los temas con duración se reproducían con `loudnorm` dinámico en una sola pasada, y cada precarga repetía la medición de 120 segundos. Los temas medidos ahora reciben normalización en dos pasadas, lineal cuando la ganancia entra bajo el techo de -1,5 dBTP.
- Una instalación nueva pregunta por el servidor de TeamSpeak y el bot entra al terminar, sin pasar por el panel web. El instalador muestra un código de un solo uso; `!claim <código>` en TeamSpeak convierte a quien lo envía en el primer administrador y guarda su UID en `RHAPSOD_ADMIN_UIDS`, que los dueños nuevos no podían completar porque no conocen su UID de TeamSpeak.
- El instalador ya no agrega Cloudflare WARP salvo con `RHAPSOD_WITH_WARP=1`; repetirlo conserva una instalación de WARP existente. Cuando falla la comprobación diaria de YouTube, `!stats` indica el arreglo según el tipo de falla: WARP para una dirección de servidor bloqueada, cookies cuando pide iniciar sesión.

## Actualización

No se requieren acciones además de los pasos de actualización de v4.0.0. Las instalaciones con `RHAPSOD_ADMIN_UIDS` configurado nunca ven un código de `!claim`. `RHAPSOD_LOUDNESS_TARGET_LUFS` mantiene su significado y su valor por defecto (-14).

## Verificación

Ejecutar `npm run check` y `npm run test:coverage`. En un equipo con ffmpeg, `npx vitest run tests/loudness-profiler.test.ts` además mide un tono generado con el binario real.
