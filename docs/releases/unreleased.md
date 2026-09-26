[Español](unreleased.es.md)

## Summary

Measured loudness normalization works for the first time: tracks with a loudness profile play at the target level without the gain riding of single-pass normalization. Optional skipping of the non-music intro and outro of YouTube music videos.

## Changes

- The loudness profiler never produced a profile: ffmpeg ran with `-loglevel error`, which hides the loudnorm report, the report was read from stdout instead of stderr, and its values, printed as strings, were rejected. Every finite track played through dynamic single-pass `loudnorm`, and each prewarm repeated the 120-second measurement. Measured tracks now get two-pass normalization, linear when the gain fits under the -1.5 dBTP ceiling.
- Add `RHAPSOD_SKIP_NON_MUSIC` (default `false`): YouTube music videos start where the music starts and end where it ends, using the non-music segments (spoken intros, scenes, credits) that SponsorBlock users mark with the `music_offtopic` category. Only an intro and an outro are cut, never a segment in the middle, and a cut that would keep less than half the track or less than 30 seconds is ignored. The lookup sends a 4-character prefix of the SHA-256 of the video id, waits at most 1.5 seconds and runs in parallel with the audio URL; when it fails the track plays whole.

## Upgrade

No action is required beyond the v4.0.0 upgrade steps. `RHAPSOD_LOUDNESS_TARGET_LUFS` keeps its meaning and default (-14). `RHAPSOD_SKIP_NON_MUSIC` is off unless set to `true`.

## Verification

Run `npm run check` and `npm run test:coverage`. On a host with ffmpeg, `npx vitest run tests/loudness-profiler.test.ts` also measures a generated tone with the real binary.
