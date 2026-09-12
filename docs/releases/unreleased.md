[Español](unreleased.es.md)

## Summary

Persistence fixes, dependency updates, deployment repairs and consistent bilingual release documentation.

## Changes

- Redesign the dashboard as a responsive listening console with animated local backgrounds, saved motion preferences, radio and autoplay controls, and keyboard seeking.
- Preserve unread favorites and listening history during shutdown; reject invalid favorite positions.
- Bound listening-track memory and expire the autoplay session boost after inactivity.
- Update compatible runtime and development dependencies, including libopus-wasm, Hono, Zod and Vitest.
- Refresh panel styling and prevent stale dashboard/settings responses, with settings-load retry.
- Repair Docker Python installation and daemon startup; preserve installer configuration and cookies on reruns.
- Standardize historical and future release notes with English and Spanish summaries, upgrade guidance and verification steps.

## Upgrade

Node.js >=22.19.0 is required. Back up configuration and data, run `npm ci` and `npm run build`, and restart when `/api/state` reports `playerState: "idle"`.

Docker Compose uses Linux host networking to keep the panel and daemon on localhost. Review the deployment guide before recreating containers. Existing data formats remain supported.

## Verification

Run `npm run check` and `npm run test:coverage`. Test an idle restart before using favorites or stats, then confirm existing preferences and listening history remain available. Check playback, radio, panel settings and daemon fallback in the target deployment.
