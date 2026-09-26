[English](unreleased.md)

## Resumen

Salto opcional de la intro y el final sin música de los videoclips de YouTube.

## Cambios

- Agregar `RHAPSOD_SKIP_NON_MUSIC` (por defecto `false`): los videoclips de YouTube empiezan donde empieza la música y terminan donde termina, según los tramos sin música (intros habladas, escenas, créditos) que los usuarios de SponsorBlock marcan con la categoría `music_offtopic`. Solo se cortan una intro y un final, nunca un tramo del medio, y se ignora un corte que dejaría menos de la mitad de la pista o menos de 30 segundos. La consulta envía un prefijo de 4 caracteres del SHA-256 del id del video, espera como máximo 1,5 segundos y corre en paralelo con la URL de audio; si falla, la pista suena completa.

## Actualización

No se requieren acciones además de los pasos de actualización de v4.0.0. `RHAPSOD_SKIP_NON_MUSIC` queda desactivado salvo que se defina en `true`.

## Verificación

Ejecutar `npm run check` y `npm run test:coverage`.
