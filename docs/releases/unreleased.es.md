[English](unreleased.md)

## Resumen

La normalización de volumen medida funciona por primera vez: los temas con un perfil de sonoridad suenan al nivel objetivo sin las variaciones de ganancia de la normalización en una sola pasada.

## Cambios

- El medidor de sonoridad nunca generaba un perfil: ffmpeg se ejecutaba con `-loglevel error`, que oculta el informe de loudnorm, el informe se leía de stdout en lugar de stderr y sus valores, impresos como texto, se rechazaban. Todos los temas con duración se reproducían con `loudnorm` dinámico en una sola pasada, y cada precarga repetía la medición de 120 segundos. Los temas medidos ahora reciben normalización en dos pasadas, lineal cuando la ganancia entra bajo el techo de -1,5 dBTP.
- Registrar y contar las fallas del daemon de yt-dlp en lugar de pasar en silencio al respaldo: el bot avisa como máximo una vez por minuto, el daemon escribe las fallas en su journal y `/api/metrics` exporta `rhapsod_ytdlp_daemon_up` y `rhapsod_ytdlp_daemon_fallbacks_total`.
- Hacer que `/api/health` responda 503 durante la reconexión a TeamSpeak (antes informaba conectado a partir de un id de canal en caché) y agregar a su cuerpo el estado del inicio de sesión de YouTube y del daemon.
- Vaciar el archivo de log antes de salir, para que la última línea previa a una caída o un reinicio llegue a `data/logs`.
- La sonoridad del tema siguiente se mide desde que empieza el tema actual en lugar de cuando se prepara su flujo precargado a mitad del tema, así la primera reproducción usa su perfil medido. No se mide nada con la cola detenida, para que una segunda descarga no compita con un inicio en frío.
- El perfil de sonoridad cubre el tema completo en lugar de sus primeros 120 segundos, así una ganancia lineal calculada para una introducción suave no puede saturar un estribillo más fuerte. Los temas de más de 15 minutos no se miden y mantienen el filtro dinámico.

## Actualización

No se requieren acciones además de los pasos de actualización de v4.0.0. `RHAPSOD_LOUDNESS_TARGET_LUFS` mantiene su significado y su valor por defecto (-14).

## Verificación

Ejecutar `npm run check` y `npm run test:coverage`. En un equipo con ffmpeg, `npx vitest run tests/loudness-profiler.test.ts` además mide un tono generado con el binario real.
