[Español](unreleased.es.md)

## Summary

Measured loudness normalization works for the first time: tracks with a loudness profile play at the target level without the gain riding of single-pass normalization.

## Changes

- The loudness profiler never produced a profile: ffmpeg ran with `-loglevel error`, which hides the loudnorm report, the report was read from stdout instead of stderr, and its values, printed as strings, were rejected. Every finite track played through dynamic single-pass `loudnorm`, and each prewarm repeated the 120-second measurement. Measured tracks now get two-pass normalization, linear when the gain fits under the -1.5 dBTP ceiling.
- The next track's loudness is measured from the moment the current track starts instead of when its warm stream is built at the midpoint, so first plays use their measured profile. Nothing is measured while the queue is idle, to keep a second download away from a cold start.
- The loudness profile covers the whole track instead of its first 120 seconds, so linear gain sized for a quiet intro cannot clip a louder chorus. Tracks longer than 15 minutes are not measured and keep the dynamic filter.
- Measured tracks play through a fixed `volume` gain followed by `alimiter` at -1.5 dBFS instead of `loudnorm` with `linear=true`, which switched to its dynamic mode without notice whenever the measured loudness range was above 11 LU: wide-range tracks were still gain-ridden and resampled to 192 kHz and back. The boost is capped at +12 dB. On a 3-minute test file this used 0.3 s of CPU and 16 MB of memory instead of 9 s and 129 MB. The bot checks `ffmpeg -filters` at startup; a build without `alimiter` logs a warning and keeps the `loudnorm` linear pass.

## Upgrade

No action is required beyond the v4.0.0 upgrade steps. `RHAPSOD_LOUDNESS_TARGET_LUFS` keeps its meaning and default (-14).

## Verification

Run `npm run check` and `npm run test:coverage`. On a host with ffmpeg, `npx vitest run tests/loudness-profiler.test.ts` also measures a generated tone with the real binary.
