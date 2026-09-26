[Español](unreleased.es.md)

## Summary

Measured loudness normalization works for the first time: tracks with a loudness profile play at the target level without the gain riding of single-pass normalization.

## Changes

- The loudness profiler never produced a profile: ffmpeg ran with `-loglevel error`, which hides the loudnorm report, the report was read from stdout instead of stderr, and its values, printed as strings, were rejected. Every finite track played through dynamic single-pass `loudnorm`, and each prewarm repeated the 120-second measurement. Measured tracks now get two-pass normalization, linear when the gain fits under the -1.5 dBTP ceiling.

## Upgrade

No action is required beyond the v4.0.0 upgrade steps. `RHAPSOD_LOUDNESS_TARGET_LUFS` keeps its meaning and default (-14).

## Verification

Run `npm run check` and `npm run test:coverage`. On a host with ffmpeg, `npx vitest run tests/loudness-profiler.test.ts` also measures a generated tone with the real binary.
