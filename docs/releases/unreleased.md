[Español](unreleased.es.md)

## Summary

Measured loudness normalization works for the first time: tracks with a loudness profile play at the target level without the gain riding of single-pass normalization.

## Changes

- The loudness profiler never produced a profile: ffmpeg ran with `-loglevel error`, which hides the loudnorm report, the report was read from stdout instead of stderr, and its values, printed as strings, were rejected. Every finite track played through dynamic single-pass `loudnorm`, and each prewarm repeated the 120-second measurement. Measured tracks now get two-pass normalization, linear when the gain fits under the -1.5 dBTP ceiling.
- A new install asks for the TeamSpeak server and the bot joins it when the install ends, without the web panel. The installer prints a one-time code; `!claim <code>` in TeamSpeak makes the sender the first admin and saves the UID in `RHAPSOD_ADMIN_UIDS`, which new owners could not fill because they do not know their TeamSpeak UID.
- The installer no longer adds Cloudflare WARP unless `RHAPSOD_WITH_WARP=1` is set; a rerun keeps an existing WARP setup. When the daily YouTube check fails, `!stats` names the fix for the kind of failure: WARP for a blocked server address, cookies for a login request.

## Upgrade

No action is required beyond the v4.0.0 upgrade steps. Installs with `RHAPSOD_ADMIN_UIDS` set never see a claim code. `RHAPSOD_LOUDNESS_TARGET_LUFS` keeps its meaning and default (-14).

## Verification

Run `npm run check` and `npm run test:coverage`. On a host with ffmpeg, `npx vitest run tests/loudness-profiler.test.ts` also measures a generated tone with the real binary.
