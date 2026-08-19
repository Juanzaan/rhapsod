# Changelog

All notable changes to Rhapsod are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims
for [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Spotify track links in `!play`: metadata via the Spotify Web API (client
  credentials flow) and YouTube equivalent searched by "artist title".
  Requires `RHAPSOD_SPOTIFY_CLIENT_ID` / `RHAPSOD_SPOTIFY_CLIENT_SECRET`.
- `!play` accepts free text and runs the YouTube search (same behavior as
  `!yt`). Unsupported providers (local files, generic URLs, Spotify
  playlists/albums) fail with clear messages.
- Common `MusicResolver` contract (`src/media/music-resolver.ts`) implemented
  by the YouTube, SoundCloud, and Spotify resolvers.

### Fixed

- ffmpeg zombies after `!skip`: `SIGKILL` after 3s when `SIGTERM` is ignored
  by an HLS download stuck in a futex wait (`998fe2d`).
- Audio drift on buffer underruns: continuous silence frames instead of gaps
  in the frame flow, lower prebuffer, immediate recovery, opus complexity 10→5
  (`59a7778`).
- Search ranking rejected valid results: no penalty for version terms present
  in the query, fuzzy term matching (Levenshtein ≤ 1), channel-name credits,
  and a shortened-query retry (`4b1101a`, `67bc1d5`).
- Spot on the production unit file: `SPOTIFY_*` renamed to `RHAPSOD_SPOTIFY_*`
  so the config schema picks them up.

### Changed

- Chat messages no longer announce "fuente alternativa".
- Deployment documented for systemd with the production unit file
  (`docs/deployment.md`).
