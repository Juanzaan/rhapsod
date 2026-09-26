[Español](unreleased.es.md)

## Summary

Measured loudness normalization works for the first time: tracks with a loudness profile play at the target level without the gain riding of single-pass normalization.

## Changes

- The loudness profiler never produced a profile: ffmpeg ran with `-loglevel error`, which hides the loudnorm report, the report was read from stdout instead of stderr, and its values, printed as strings, were rejected. Every finite track played through dynamic single-pass `loudnorm`, and each prewarm repeated the 120-second measurement. Measured tracks now get two-pass normalization, linear when the gain fits under the -1.5 dBTP ceiling.
- The next track's loudness is measured from the moment the current track starts instead of when its warm stream is built at the midpoint, so first plays use their measured profile. Nothing is measured while the queue is idle, to keep a second download away from a cold start.
- The loudness profile covers the whole track instead of its first 120 seconds, so linear gain sized for a quiet intro cannot clip a louder chorus. Tracks longer than 15 minutes are not measured and keep the dynamic filter.
- A song already in the queue is now skipped by its error type, not by the wording of its Spanish chat message. Before, rewording "Esa canción ya está en la cola." would make a playlist, Spotify or Apple Music collection with a queued song fail as a whole. SoundCloud DRM errors are recognized the same way; yt-dlp DRM output is still matched by its text, since yt-dlp reports it only there.

## Upgrade

No action is required beyond the v4.0.0 upgrade steps. `RHAPSOD_LOUDNESS_TARGET_LUFS` keeps its meaning and default (-14).

## Verification

Run `npm run check` and `npm run test:coverage`. On a host with ffmpeg, `npx vitest run tests/loudness-profiler.test.ts` also measures a generated tone with the real binary.
