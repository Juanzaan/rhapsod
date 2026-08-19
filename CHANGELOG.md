# Changelog

All notable changes to Rhapsod are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims
for [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `!volume <0-100>`: PCM gain applied to frames before Opus encoding, affecting
  every listener; changes apply live to the current track.
- `!loop [off|track|queue]`: repeat the current track (`track`) or the whole
  queue (`queue`); `!stop`/`!clear` disable looping.
- `RHAPSOD_TS3_CLIENT_DESCRIPTION` sets the bot's TeamSpeak client description
  (any client can set its own description; no server permissions needed).
- `test:coverage` script.

## [1.0.0] - 2026-08-19

### Added

- Spotify track links in `!play`: metadata via the Spotify Web API (client
  credentials flow, no user login) and the matching "artist title" searched on
  YouTube for playback. Requires `RHAPSOD_SPOTIFY_CLIENT_ID` /
  `RHAPSOD_SPOTIFY_CLIENT_SECRET`.
- `!play` accepts free text and runs the YouTube search (same behavior as
  `!yt`). Unsupported providers (local files, generic URLs, Spotify
  playlists/albums) fail with clear messages.
- Resolver contract defined by the application service
  (`YoutubePlaybackResolver`) with `name`/`match` on each media provider.

### Fixed

- ffmpeg zombies after `!skip`: `SIGKILL` after 3s when `SIGTERM` is ignored
  by an HLS download stuck in a futex wait (`998fe2d`).
- Audio drift on buffer underruns: continuous silence frames instead of gaps
  in the frame flow, lower prebuffer, immediate recovery, opus complexity 10→5
  (`59a7778`).
- Search ranking rejected valid results: no penalty for version terms present
  in the query, fuzzy term matching (Levenshtein ≤ 1), channel-name credits,
  and a shortened-query retry (`4b1101a`, `67bc1d5`).
- Spotify credentials on the production unit file: `SPOTIFY_*` renamed to
  `RHAPSOD_SPOTIFY_*` so the config schema picks them up.

### Changed

- Chat messages no longer announce "fuente alternativa".
- Deployment documented for systemd with the production unit file
  (`docs/deployment.md`), including `MemoryMax`/`MemorySwapMax` limits.
- Removed dead `src/ports` contracts and superseded abstractions; the TS3
  adapter now exposes the only connection contract the application needs.
