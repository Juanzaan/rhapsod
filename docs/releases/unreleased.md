[Español](unreleased.es.md)

## Summary

Persistence fixes, dependency updates, deployment repairs and consistent bilingual release documentation.

## Changes

- Extend the listening-room design to Settings, Commands, Setup and Server; add channel search, empty-channel counts and expand/collapse controls. Fix raw channel-name parsing, missing-parent rendering and settings read-only rendering.
- Show every visible channel, including empty ones: the server tree is now discovered by probing `channelinfo` per channel id in the background (voice clients cannot run `channellist`), refreshed at startup, on reconnect and every ten minutes.
- Redesign the dashboard as a responsive listening console with animated local backgrounds, saved motion preferences, radio and autoplay controls, and keyboard seeking.
- Preserve unread favorites and listening history during shutdown; reject invalid favorite positions.
- Bound listening-track memory and expire the autoplay session boost after inactivity.
- Update compatible runtime and development dependencies, including libopus-wasm, Hono, Zod and Vitest.
- Refresh panel styling and prevent stale dashboard/settings responses, with settings-load retry.
- Repair Docker Python installation and daemon startup; preserve installer configuration and cookies on reruns.
- Standardize historical and future release notes with English and Spanish summaries, upgrade guidance and verification steps.
- Keep autoplay playing after a restart: recent listening history seeds the mix rotation and restores the last listener's taste instead of starting silent.
- Play radio streams that refuse HEAD probes: Icecast and Shoutcast stations answering 400 are confirmed with a one-byte ranged GET, with added Shoutcast AAC content types.
- Play pasted TuneIn links (tun.in short links and tunein.com pages) in !play and !radio, resolving them to the station stream.
- Use the same animated background, scene picker and motion control on every panel page, not only the dashboard.
- Show spacer section labels as plain headers that can never be joined or moved, and order siblings by channel_order chains like the TeamSpeak client.

## Upgrade

Node.js >=22.19.0 is required. Back up configuration and data, run `npm ci` and `npm run build`, and restart when `/api/state` reports `playerState: "idle"`.

Docker Compose uses Linux host networking to keep the panel and daemon on localhost. Review the deployment guide before recreating containers. Existing data formats remain supported.

## Verification

Run `npm run check` and `npm run test:coverage`. Test an idle restart before using favorites or stats, then confirm existing preferences and listening history remain available. Check playback, radio, panel settings and daemon fallback in the target deployment.
