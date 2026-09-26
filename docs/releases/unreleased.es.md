[English](unreleased.md)

## Resumen

La normalización de volumen medida funciona por primera vez: los temas con un perfil de sonoridad suenan al nivel objetivo sin las variaciones de ganancia de la normalización en una sola pasada. Salto opcional de la intro y el final sin música de los videoclips de YouTube.

## Cambios

- El medidor de sonoridad nunca generaba un perfil: ffmpeg se ejecutaba con `-loglevel error`, que oculta el informe de loudnorm, el informe se leía de stdout en lugar de stderr y sus valores, impresos como texto, se rechazaban. Todos los temas con duración se reproducían con `loudnorm` dinámico en una sola pasada, y cada precarga repetía la medición de 120 segundos. Los temas medidos ahora reciben normalización en dos pasadas, lineal cuando la ganancia entra bajo el techo de -1,5 dBTP.
- Agregar `RHAPSOD_SKIP_NON_MUSIC` (por defecto `false`): los videoclips de YouTube empiezan donde empieza la música y terminan donde termina, según los tramos sin música (intros habladas, escenas, créditos) que los usuarios de SponsorBlock marcan con la categoría `music_offtopic`. Solo se cortan una intro y un final, nunca un tramo del medio, y se ignora un corte que dejaría menos de la mitad de la pista o menos de 30 segundos. La consulta envía un prefijo de 4 caracteres del SHA-256 del id del video, espera como máximo 1,5 segundos y corre en paralelo con la URL de audio; si falla, la pista suena completa.

## Actualización

No se requieren acciones además de los pasos de actualización de v4.0.0. `RHAPSOD_LOUDNESS_TARGET_LUFS` mantiene su significado y su valor por defecto (-14). `RHAPSOD_SKIP_NON_MUSIC` queda desactivado salvo que se defina en `true`.

## Verificación

Ejecutar `npm run check` y `npm run test:coverage`. En un equipo con ffmpeg, `npx vitest run tests/loudness-profiler.test.ts` además mide un tono generado con el binario real.
