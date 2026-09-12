# Rhapsod

[Español](README.es.md)

A self-hosted TeamSpeak 3 music bot with shared queues, adaptive autoplay, radio and a local administration panel. TeamSpeak 6 support is planned.

[![CI](https://github.com/Juanzaan/rhapsod/actions/workflows/ci.yml/badge.svg)](https://github.com/Juanzaan/rhapsod/actions/workflows/ci.yml) [![Release](https://img.shields.io/github/v/release/Juanzaan/rhapsod)](https://github.com/Juanzaan/rhapsod/releases) [![Node](https://img.shields.io/badge/node-%3E%3D22.19-339933)](https://nodejs.org)

## Playback

- YouTube videos, playlists and music searches; SoundCloud tracks and sets.
- Spotify metadata matched to YouTube audio. Apple Music and Amazon Music links resolved to available alternatives through SongLink.
- Public HTTPS audio files and radio streams, with station search and live titles.
- Saved playlists, per-user favorites, preferred search source and listening statistics.
- Opus stereo audio, loudness normalization, prewarmed transitions and FFmpeg effects.

Spotify never supplies playback. Local files are unsupported. DRM-protected or blocked content is reported rather than bypassed.

## Requirements

- **Node.js >=22.19.0** and npm. CI checks the minimum version, current Node 22 and Node 24.
- `yt-dlp`, FFmpeg and `ffprobe`; executable paths can be configured in `.env`.
- A TeamSpeak 3 server reachable over UDP and permission for the bot to join, speak and use channel chat.

The active release line is **3.x**. The 1.x low-resource and 2.x deployment profiles are historical; use [GitHub Releases](https://github.com/Juanzaan/rhapsod/releases) to select a published version. `main` may include changes awaiting release.

## Install

For a supported Linux VPS, follow the [installation guide](docs/install.md). The installer creates systemd services and starts the local setup wizard.

For a manual checkout:

```bash
git clone https://github.com/Juanzaan/rhapsod.git
cd rhapsod
npm ci
cp .env.example .env
```

Set `RHAPSOD_TS3_HOST` in `.env`, then build and start:

```bash
npm run build
npm start
```

To configure through the browser first, set `RHAPSOD_TS3_AUTO_CONNECT=false`, `RHAPSOD_PANEL_ENABLED=true` and a unique `RHAPSOD_PANEL_PASSWORD`. Keep `RHAPSOD_PANEL_HOST=127.0.0.1`. For a remote host:

```bash
ssh -N -L 8080:127.0.0.1:8080 user@host
```

Open `http://127.0.0.1:8080/setup`. The full setting reference is [`.env.example`](.env.example); validation and defaults live in [`src/config.ts`](src/config.ts).

## Use

```text
!play artist song
!queue
!skip
!fav
!autoplay on
!radio jazz
!help
```

Chat responses are in Spanish. Most commands are shared; skipping or removing another user's tracks requires an administrator listed in `RHAPSOD_ADMIN_UIDS`. Autoplay picks are communal. See the [command reference](docs/commands.md) for aliases, permissions and limits.

## Operate and update

Persist `RHAPSOD_DATA_DIR`: it contains the TeamSpeak identity, queue, playlists, preferences and listening history. Back it up together with the environment file before updating. Check `/api/state` and wait for `playerState: "idle"` before restarting.

Use the [deployment guide](docs/deployment.md) for systemd, Docker, backup, tagged updates and rollback. Release-specific behavior changes are listed in the [release archive](docs/releases.md) and [changelog](CHANGELOG.md).

## Development

```bash
npm ci
npm run check
npm run test:coverage
```

`npm run check` runs formatting, lint, script and documentation validation, type checking, tests and build. `npm run dev` starts the development watcher with local configuration.

## Documentation

- [Install](docs/install.md) and [deployment](docs/deployment.md)
- [Commands](docs/commands.md) and [architecture](docs/architecture.md)
- [Dashboard and animated backgrounds](docs/dashboard.md)
- [Releases and publishing](docs/releases.md)
- [Roadmap](docs/roadmap.md) and [bot research](docs/research-ts3-bots.md)
- [Optional voice routing](docs/warp-voice-egress.md)
- [Contributing](CONTRIBUTING.md) and [security policy](SECURITY.md)

Report problems using the [bug template](https://github.com/Juanzaan/rhapsod/issues/new?template=bug_report.yml), including the version from `package.json`, relevant sanitized logs and reproduction steps.

## License

[MIT](LICENSE). TeamSpeak is a trademark of TeamSpeak Systems GmbH. Rhapsod is not affiliated with or endorsed by TeamSpeak.
