[Español](unreleased.es.md)

## Summary

Measured loudness normalization works for the first time: tracks with a loudness profile play at the target level without the gain riding of single-pass normalization.

## Changes

- The loudness profiler never produced a profile: ffmpeg ran with `-loglevel error`, which hides the loudnorm report, the report was read from stdout instead of stderr, and its values, printed as strings, were rejected. Every finite track played through dynamic single-pass `loudnorm`, and each prewarm repeated the 120-second measurement. Measured tracks now get two-pass normalization, linear when the gain fits under the -1.5 dBTP ceiling.
- Panel: every page uses the same 1320px frame, so the nav no longer shifts between pages. Cards in a console row share their height and the queue scrolls inside its card; Settings and Commands show each group full width with an even grid of fields and commands.
- Panel: the Server page no longer rebuilds the channel tree every 2.5 seconds when nothing changed, which cut hover transitions mid-way. With the system set to reduce motion, only the background and the turntable stop; click and hover feedback stay.
- Panel: player states read in Spanish (SONANDO, EN PAUSA, CARGANDO, EN ESPERA), and the setup wizard points new installs to `!claim` for the first admin, with the admin UID field moved to an advanced section.

## Upgrade

No action is required beyond the v4.0.0 upgrade steps. `RHAPSOD_LOUDNESS_TARGET_LUFS` keeps its meaning and default (-14).

## Verification

Run `npm run check` and `npm run test:coverage`. On a host with ffmpeg, `npx vitest run tests/loudness-profiler.test.ts` also measures a generated tone with the real binary.
