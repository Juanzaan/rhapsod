<p align="center">
  <img src="docs/assets/logo.svg" width="120" alt="Rhapsod logo" />
</p>

<h1 align="center">Rhapsod</h1>

<p align="center">
  A self-hosted music bot for TeamSpeak 3.
  <br />
  <em>Architected so TeamSpeak 6 support can be added without touching the audio pipeline.</em>
</p>

<p align="center">
  <a href="https://github.com/Juanzaan/rhapsod/actions/workflows/ci.yml"><img src="https://github.com/Juanzaan/rhapsod/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
  <a href="https://github.com/Juanzaan/rhapsod/releases"><img src="https://img.shields.io/github/v/release/Juanzaan/rhapsod" alt="Latest release" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22.12-339933" alt="Node.js >= 22.12" />
  <a href="LICENSE"><img src="https://img.shields.io/github/license/Juanzaan/rhapsod" alt="License" /></a>
</p>

## Features

- **Multi-source playback** — YouTube videos, Shorts and playlists, SoundCloud tracks, Spotify tracks (metadata only, playback via YouTube), and Apple Music / Amazon Music links (resolved via SongLink).
- **Smart search** — `!play` and `!yt` accept free text and rank YouTube candidates with fuzzy term matching, channel credits, duration checks, and a shortened-query retry when nothing is reliable.
- **Playlist queue** — pause, resume, skip, stop, remove, and clear; playlists add up to 20 tracks per command with duplicate detection.
- **Resilient audio transport** — buffered Opus voice stream that keeps the frame flow alive during underruns and force-kills stuck FFmpeg processes.
- **Respects content rights** — DRM-protected and blocked SoundCloud tracks are reported, never bypassed.
- **Adapter isolation** — the TS3 adapter, resolvers, and audio pipeline are
  separated behind narrow interfaces, keeping a future TS6 adapter a drop-in
  change without touching the playback core.

## Quick start

```bash
npm install
cp .env.example .env   # set RHAPSOD_TS3_HOST, RHAPSOD_TS3_PORT, ...
npm run dev            # or: npm run build && npm start
```

Requirements: Node.js 22.12+, `yt-dlp` on PATH (or `RHAPSOD_YTDLP_PATH`), and a TeamSpeak 3 server with voice permission for the bot. A system FFmpeg is recommended in production (`RHAPSOD_FFMPEG_PATH`).

## Commands

| Command                     | Alias                 | Description                                                                      |
| --------------------------- | --------------------- | -------------------------------------------------------------------------------- |
| `!play <URL or text>`       | `!p`                  | Queue a YouTube/SoundCloud/Spotify/Apple Music/Amazon Music link or run a search |
| `!playnext <URL or text>`   | `!pn`, `!next`        | Add a single track or search result at the front of the pending queue            |
| `!yt [n] <search terms>`    | `!search`, `!youtube` | Add a matching YouTube video; a leading number picks the n-th ranked result      |
| `!pause` / `!resume`        | -                     | Pause / resume the current track                                                 |
| `!skip`                     | `!s`                  | Skip the current track                                                           |
| `!stop`                     | -                     | Stop playback and clear the session                                              |
| `!queue [page]`             | `!q`                  | Show 10 pending tracks per page with durations                                   |
| `!history`                  | `!hist`               | Show the 10 most recently started tracks                                         |
| `!now-playing`              | `!np`, `!now`         | Show the current track                                                           |
| `!stats`                    | `!st`                 | Show uptime, tracks played, current track, queue and volume/loop state           |
| `!volume <0-100>`           | `!vol`, `!v`          | Adjust the bot output volume (default `50`; persists across restarts)            |
| `!move <from> <to>`         | `!mv`                 | Move a pending track to another position                                         |
| `!remove <n\|from-to>`      | `!rm`                 | Remove a queue position or inclusive range (requester or admin)                  |
| `!clear`                    | `!c`                  | Clear pending tracks                                                             |
| `!shuffle`                  | -                     | Shuffle the pending queue                                                        |
| `!loop [off\|track\|queue]` | -                     | Repeat the current track or the whole queue (persists across restarts)           |
| `!lyrics`                   | `!ly`                 | Show the lyrics of the current track                                             |
| `!test-tone`                | `!tone`               | Play a 3-second test tone (rate-limited)                                         |
| `!help`                     | `!h`                  | Show the command summary                                                         |

See [docs/commands.md](docs/commands.md) for details and source behavior.

## Configuration

All settings are environment variables (see `.env.example`):

| Variable                              | Required | Description                                                                                |
| ------------------------------------- | -------- | ------------------------------------------------------------------------------------------ |
| `RHAPSOD_TS3_HOST`                    | yes      | TeamSpeak 3 server address                                                                 |
| `RHAPSOD_TS3_PORT`                    | no       | Voice port (default `9987`)                                                                |
| `RHAPSOD_TS3_NICKNAME`                | no       | Bot nickname (default `Rhapsod`)                                                           |
| `RHAPSOD_TS3_PASSWORD`                | no       | Server password                                                                            |
| `RHAPSOD_TS3_CHANNEL_NAME`            | no       | Target channel; bot joins the default channel if unset                                     |
| `RHAPSOD_TS3_CHANNEL_PASSWORD`        | no       | Target channel password                                                                    |
| `RHAPSOD_TS3_CLIENT_DESCRIPTION`      | no       | Client description shown in TeamSpeak (BBCode allowed)                                     |
| `RHAPSOD_TS3_CONNECT_TIMEOUT_SECONDS` | no       | Connect timeout (default `180`)                                                            |
| `RHAPSOD_TS3_AUTO_CONNECT`            | no       | Connect at startup (default `true`)                                                        |
| `RHAPSOD_ADMIN_UIDS`                  | no       | Comma-separated TeamSpeak uids with bot-admin rights (empty = no admins)                   |
| `RHAPSOD_DATA_DIR`                    | no       | Data directory for the TS3 identity and `state.json` (default `./data`)                    |
| `RHAPSOD_YTDLP_PATH`                  | no       | `yt-dlp` binary path (default `yt-dlp`)                                                    |
| `RHAPSOD_YTDLP_COOKIES_PATH`          | no       | Private cookies file for datacenter extraction                                             |
| `RHAPSOD_FFMPEG_PATH`                 | no       | System FFmpeg binary path                                                                  |
| `RHAPSOD_OPUS_BITRATE`                | no       | Opus bitrate in bits/s (default `96000`; keep under the TeamSpeak 497-byte packet ceiling) |
| `RHAPSOD_OPUS_COMPLEXITY`             | no       | Opus encoder complexity 0-10 (default `10`; ~0.06 ms/frame extra on 1 vCPU)                |
| `RHAPSOD_OPUS_PACKET_LOSS_PERCENT`    | no       | Expected network loss for in-band FEC; `0` disables FEC (default `0`)                      |
| `RHAPSOD_SPOTIFY_CLIENT_ID`           | no       | Spotify app credentials (enables Spotify links)                                            |
| `RHAPSOD_SPOTIFY_CLIENT_SECRET`       | no       | Same app's secret; used only for client credentials                                        |
| `RHAPSOD_AUDIO_TEST_TONE_SECONDS`     | no       | Play a test tone for N seconds to validate voice setup                                     |
| `RHAPSOD_LOG_LEVEL`                   | no       | pino log level (default `info`)                                                            |
| `RHAPSOD_LOUDNESS_TARGET_LUFS`        | no       | EBU R128 loudness target for playback; `0` disables (default `-14`)                        |
| `RHAPSOD_METRICS_INTERVAL_MINUTES`    | no       | Log RSS/heap every N minutes; `0` disables (default `15`)                                  |
| `RHAPSOD_WATCHDOG_INTERVAL_MINUTES`   | no       | Restart the process if the event loop stalls; `0` disables (default `15`)                  |

Secrets (cookies, Spotify credentials, TS3 passwords) live only in `.env` or the
deployment secret store — never in Git. For production under systemd see
[docs/deployment.md](docs/deployment.md).

## Architecture

```
src/
  adapters/ts3/        TeamSpeak 3 voice and chat adapter
  application/         playback service: queue, resolution pipeline, fallbacks
  audio/               FFmpeg PCM pipeline, Opus encoder, frame scheduler
  commands/            chat command parser and rate limiter
  domain/              queue and track models
  media/               YouTube / SoundCloud / Spotify resolvers, ranking, SongLink
  types/               ambient type declarations for external packages
  main.ts              composition root
```

## Documentation

- [Changelog](CHANGELOG.md)
- [Architecture](docs/architecture.md)
- [Commands](docs/commands.md)
- [Deployment](docs/deployment.md)
- [Roadmap](docs/roadmap.md)
- [TS3 bot research](docs/research-ts3-bots.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## License

Rhapsod is licensed under the [MIT License](LICENSE). TeamSpeak is a trademark
of TeamSpeak Systems GmbH. Rhapsod is not affiliated with or endorsed by
TeamSpeak.
