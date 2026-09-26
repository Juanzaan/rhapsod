[Español](unreleased.es.md)

## Summary

Optional skipping of the non-music intro and outro of YouTube music videos.

## Changes

- Add `RHAPSOD_SKIP_NON_MUSIC` (default `false`): YouTube music videos start where the music starts and end where it ends, using the non-music segments (spoken intros, scenes, credits) that SponsorBlock users mark with the `music_offtopic` category. Only an intro and an outro are cut, never a segment in the middle, and a cut that would keep less than half the track or less than 30 seconds is ignored. The lookup sends a 4-character prefix of the SHA-256 of the video id, waits at most 1.5 seconds and runs in parallel with the audio URL; when it fails the track plays whole.

## Upgrade

No action is required beyond the v4.0.0 upgrade steps. `RHAPSOD_SKIP_NON_MUSIC` is off unless set to `true`.

## Verification

Run `npm run check` and `npm run test:coverage`.
