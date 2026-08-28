# Rhapsod

A self-hosted music bot for TeamSpeak 3 that plays YouTube, SoundCloud, Spotify, Apple Music and Amazon Music links, and direct audio URLs, into a voice channel.

[![CI status](https://github.com/Juanzaan/rhapsod/actions/workflows/ci.yml/badge.svg)](https://github.com/Juanzaan/rhapsod/actions/workflows/ci.yml) [![Release](https://img.shields.io/github/v/release/Juanzaan/rhapsod)](https://github.com/Juanzaan/rhapsod/releases) [![Node](https://img.shields.io/badge/node-%3E%3D22.12-339933)](https://nodejs.org) [![License](https://img.shields.io/github/license/Juanzaan/rhapsod)](LICENSE)

## Requirements

- Node.js >= 22.12
- `yt-dlp` on PATH, or `RHAPSOD_YTDLP_PATH` pointing at it
- `ffmpeg` (used for playback and direct audio URLs; `RHAPSOD_FFMPEG_PATH` overrides the lookup)
- A TeamSpeak 3 server where the bot can join a channel and speak

## Quick start

```bash
git clone https://github.com/Juanzaan/rhapsod
cd rhapsod
npm install
cp .env.example .env      # set at least RHAPSOD_TS3_HOST
npm run build && npm start
```

For development, `npm run dev` runs without a build step.

## Release profiles

- **1.x** (`v1.2.1`): tuned for low-end VPS deployments (1 vCPU / 1 GB RAM).
- **2.x** (`v2.2.0`): tuned for the OCI profile (4 vCPUs / 3 GB RAM). Both lines use the same configuration.

## Commands

| Command                                                                 | Alias                 | Description                                                                                                       |
| ----------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `!play <URL or text>`                                                   | `!p`                  | Queue a YouTube/SoundCloud/Spotify/Apple Music/Amazon Music link, a direct audio URL, or run a search             |
| `!playnext <URL or text>`                                               | `!pn`, `!next`        | Add a track or search result at the front of the pending queue                                                    |
| `!yt [n] <terms>`                                                       | `!search`, `!youtube` | Add a matching YouTube video; a leading number picks the n-th ranked result                                       |
| `!seek <seconds>`                                                       | -                     | Jump within the current track                                                                                     |
| `!previous`                                                             | `!prev`               | Replay the last finished track                                                                                    |
| `!pause` / `!resume`                                                    | -                     | Pause / resume the current track                                                                                  |
| `!skip`                                                                 | `!s`                  | Skip the current track                                                                                            |
| `!stop`                                                                 | -                     | Stop playback and clear the session                                                                               |
| `!queue [page]`                                                         | `!q`                  | Show 10 pending tracks per page with durations                                                                    |
| `!history`                                                              | `!hist`               | Show the 10 most recently started tracks                                                                          |
| `!now-playing`                                                          | `!np`, `!now`         | Show the current track                                                                                            |
| `!stats`                                                                | `!st`                 | Uptime, tracks played, current track, queue and volume/loop state                                                 |
| `!volume <0-100>`                                                       | `!vol`, `!v`          | Adjust output volume (default `50`; persists across restarts)                                                     |
| `!move <from> <to>`                                                     | `!mv`                 | Move a pending track                                                                                              |
| `!channel-move <channel>`                                               | `!ch`                 | Move the bot to a matching channel (admins only)                                                                  |
| `!remove <n\|from-to>`                                                  | `!rm`                 | Remove a queue position or range (requester or admin)                                                             |
| `!clear`                                                                | `!c`                  | Clear pending tracks                                                                                              |
| `!shuffle`                                                              | -                     | Shuffle the pending queue                                                                                         |
| `!loop [off\|track\|queue]`                                             | -                     | Repeat the current track or the whole queue (persists across restarts)                                            |
| `!lyrics`                                                               | `!ly`                 | Show lyrics for the current track                                                                                 |
| `!playlist <save\|load\|list\|show\|delete\|add\|remove\|rename\|info>` | `!pl`                 | Saved playlists stored in `data/playlists.json`                                                                   |
| `!effects <8d\|nightcore\|bassboost\|vaporwave\|list\|reset>`           | -                     | Audio effects; `!bassboost`/`!bb`, `!nightcore`/`!nc`, `!vaporwave`/`!vw`, `!8d` and `!filter` also work directly |
| `!test-tone`                                                            | `!tone`               | Play a 3-second test tone (rate-limited)                                                                          |
| `!help`                                                                 | `!h`                  | Show the command summary                                                                                          |

See [docs/commands.md](docs/commands.md) for details.

## Configuration

All settings are environment variables read from `.env`. Defaults are shown; a variable with no default is optional and left unset unless you need it.

| Variable                              | Default   | Purpose                                                                                                                              |
| ------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `RHAPSOD_TS3_HOST`                    | required  | TeamSpeak 3 server address                                                                                                           |
| `RHAPSOD_TS3_PORT`                    | `9987`    | Voice port                                                                                                                           |
| `RHAPSOD_TS3_NICKNAME`                | `Rhapsod` | Bot nickname                                                                                                                         |
| `RHAPSOD_TS3_PASSWORD`                | -         | Server password                                                                                                                      |
| `RHAPSOD_TS3_CHANNEL_NAME`            | -         | Channel to join; the server default channel if unset                                                                                 |
| `RHAPSOD_TS3_CHANNEL_ID`              | -         | Channel to join by ID, overrides `RHAPSOD_TS3_CHANNEL_NAME`                                                                          |
| `RHAPSOD_TS3_CLIENT_DESCRIPTION`      | -         | Client description shown in TeamSpeak (BBCode allowed)                                                                               |
| `RHAPSOD_TS3_CONNECT_TIMEOUT_SECONDS` | `180`     | Connect timeout                                                                                                                      |
| `RHAPSOD_TS3_AUTO_CONNECT`            | `true`    | Connect at startup                                                                                                                   |
| `RHAPSOD_ADMIN_UIDS`                  | -         | Comma-separated TeamSpeak UIDs with bot-admin rights                                                                                 |
| `RHAPSOD_DATA_DIR`                    | `./data`  | TS3 identity and `state.json`                                                                                                        |
| `RHAPSOD_YTDLP_PATH`                  | `yt-dlp`  | yt-dlp binary path                                                                                                                   |
| `RHAPSOD_YTDLP_COOKIES_PATH`          | -         | Cookie file for datacenter extraction                                                                                                |
| `RHAPSOD_YTDLP_DAEMON_URL`            | -         | Persistent yt-dlp daemon (`scripts/yt-dlp-daemon.py`); the bot asks it for audio URLs before spawning yt-dlp                         |
| `RHAPSOD_FFMPEG_PATH`                 | -         | FFmpeg binary; falls back to the system lookup                                                                                       |
| `RHAPSOD_FFMPEG_USER_AGENT`           | -         | User-Agent FFmpeg sends when opening audio URLs (some CDNs reject `Lavf/…`)                                                          |
| `RHAPSOD_FFPROBE_PATH`                | `ffprobe` | Used to probe direct audio URLs                                                                                                      |
| `RHAPSOD_OPUS_BITRATE`                | `96000`   | Opus bitrate in bits/s; keep under the TeamSpeak 497-byte packet ceiling                                                             |
| `RHAPSOD_OPUS_COMPLEXITY`             | `10`      | Opus encoder complexity 0-10                                                                                                         |
| `RHAPSOD_OPUS_PACKET_LOSS_PERCENT`    | `0`       | Expected loss for in-band FEC; `0` disables FEC                                                                                      |
| `RHAPSOD_LOUDNESS_TARGET_LUFS`        | `-14`     | EBU R128 loudness target; `0` disables                                                                                               |
| `RHAPSOD_AUDIO_TEST_TONE_SECONDS`     | `0`       | Play a test tone for N seconds to validate voice setup                                                                               |
| `RHAPSOD_SPOTIFY_CLIENT_ID`           | -         | Spotify app credentials (enables Spotify links)                                                                                      |
| `RHAPSOD_SPOTIFY_CLIENT_SECRET`       | -         | Same app's secret (client-credentials flow)                                                                                          |
| `RHAPSOD_SPOTIFY_REFRESH_TOKEN`       | -         | OAuth token for Web API playlist reads; playlists otherwise read the public embed page. Get one with `node scripts/spotify-auth.mjs` |
| `RHAPSOD_LOG_LEVEL`                   | `info`    | pino log level                                                                                                                       |
| `RHAPSOD_LOG_RETENTION_DAYS`          | `14`      | Days of log files kept under `data/logs`                                                                                             |
| `RHAPSOD_METRICS_INTERVAL_MINUTES`    | `15`      | Log RSS/heap every N minutes; `0` disables                                                                                           |
| `RHAPSOD_WATCHDOG_INTERVAL_MINUTES`   | `15`      | Restart the process if the event loop stalls; `0` disables                                                                           |
| `RHAPSOD_MAX_CONCURRENT_COMMANDS`     | `3`       | Commands handled at once; extra ones get a busy reply                                                                                |
| `RHAPSOD_MAX_CONCURRENT_YTDLP_JOBS`   | auto      | 1-4; unset uses a CPU-adaptive default                                                                                               |
| `RHAPSOD_MAX_QUEUE_TRACKS`            | `200`     | Maximum pending tracks                                                                                                               |
| `RHAPSOD_MAX_TRACKS_PER_USER`         | `30`      | Maximum pending tracks per user                                                                                                      |
| `RHAPSOD_VERBOSE`                     | `false`   | Send intermediate "Preparando… / Buscando…" messages                                                                                 |

Secrets (cookies, Spotify credentials, TS3 passwords) live only in `.env` or the deployment secret store, never in Git. For production under systemd see [docs/deployment.md](docs/deployment.md). The full variable list is in `.env.example`.

## Troubleshooting

**Bot does not connect to TeamSpeak**

- Check `RHAPSOD_TS3_HOST`, `RHAPSOD_TS3_PORT` and `RHAPSOD_TS3_PASSWORD` in `.env`.
- Confirm the bot has permission to join the server and the target channel.
- Run `npm start` in the foreground and read the log output.

**YouTube tracks do not play**

- Update yt-dlp (`yt-dlp -U`) and confirm it resolves the video on its own.
- From a datacenter IP, export YouTube cookies to a file and set `RHAPSOD_YTDLP_COOKIES_PATH`.
- The logs say "cookies are probably expired" when they need to be re-exported.

**Direct audio URLs do not play**

- The URL must be `https:`; `http:` is rejected.
- Confirm `ffprobe` is available or set `RHAPSOD_FFPROBE_PATH`.

**Bot does not respond to commands**

- Confirm it joined the intended channel (`RHAPSOD_TS3_CHANNEL_NAME`) and can speak there.
- Admin commands require your UID in `RHAPSOD_ADMIN_UIDS`.

**Permission errors on `data/`**

- The user running the service must own `RHAPSOD_DATA_DIR` (Linux: `chmod -R 700 data/`).

**Reporting a bug**

- Use the [bug report template](https://github.com/Juanzaan/rhapsod/issues/new?template=bug_report.yml) and include the version (`git describe --tags`) plus the relevant log lines.

## What it does not do

It does not download or cache music files, and it does not bypass DRM or geo-blocking: DRM-protected and blocked SoundCloud tracks are reported, not played.

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

Rhapsod is licensed under the [MIT License](LICENSE). TeamSpeak is a trademark of TeamSpeak Systems GmbH. Rhapsod is not affiliated with or endorsed by TeamSpeak.
