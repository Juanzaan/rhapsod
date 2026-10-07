[Español](unreleased.es.md)

## Summary

A pasted YouTube link starts sooner: its title and duration come from the same request that finds the audio, so no yt-dlp process runs first.

## Changes

- `!play <YouTube link>` reads the title, duration and audio URL from one Innertube player request. Live streams, unplayable videos and responses without a plain audio URL keep the yt-dlp path. The log line `Track metadata resolved` with `winner: "innertube-android-vr"` marks the fast path.

## Upgrade

No action is required beyond the v4.1.0 upgrade steps.

## Verification

Run `npm run check` and `npm run test:coverage`.
