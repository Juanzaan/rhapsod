[Español](unreleased.es.md)

## Summary

A pasted YouTube link starts sooner: its title and duration come from the same request that finds the audio, so no yt-dlp process runs first.

## Changes

- `!play <YouTube link>` reads the title, duration and audio URL from one Innertube player request. Live streams, unplayable videos and responses without a plain audio URL keep the yt-dlp path. The log line `Track metadata resolved` with `winner: "innertube-android-vr"` marks the fast path.
- When the ANDROID_VR client answers without a plain audio URL or with an error, the bot asks the VISIONOS client before starting yt-dlp. A timeout does not move to the next client, so the wait before yt-dlp stays at 5 s. The log shows `winner: "innertube-visionos"` when the second client wins. TV and mobile web clients are not used: their URLs need YouTube's player JavaScript to decode.
- The Docker image no longer carries the build's development packages (TypeScript, esbuild, ESLint, Vitest and others, about 75 MB uncompressed): `npm prune` now runs in the build stage, before `node_modules` is copied into the runtime image.

## Upgrade

No action is required beyond the v4.1.0 upgrade steps.

## Verification

Run `npm run check` and `npm run test:coverage`.
