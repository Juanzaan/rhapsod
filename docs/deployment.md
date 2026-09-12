# Deployment

[Español](deployment.es.md)

Run Rhapsod as a persistent service with Node.js >=22.19.0, FFmpeg, ffprobe and yt-dlp. The active release line is 3.x. The historical 1.x profile used 1 vCPU / 1 GB; the 2.x production profile used 4 vCPUs / 3 GB. Tune current deployments from measured memory and audio health.

## Configuration and state

The process loads `.env` from its working directory. An existing process environment takes precedence. `RHAPSOD_ENV_FILE` selects the file edited by the panel; when systemd loads `/etc/rhapsod.env`, point the panel at that same file.

```dotenv
RHAPSOD_TS3_HOST=voice.example.com
RHAPSOD_TS3_PORT=9987
RHAPSOD_TS3_NICKNAME=Rhapsod
RHAPSOD_DATA_DIR=/var/lib/rhapsod
RHAPSOD_PANEL_ENABLED=true
RHAPSOD_PANEL_HOST=127.0.0.1
RHAPSOD_PANEL_PASSWORD=replace-with-a-unique-password
RHAPSOD_ENV_FILE=/etc/rhapsod.env
```

Persist the whole data directory, including `ts3-identity.txt`, `state.json`, playlists, preferences, listening history and caches. Keep environment files, identities and cookies out of Git. Spotify credentials enable metadata lookups; an optional refresh token enables authenticated playlist metadata reads.

## systemd

The installer creates units appropriate to its paths. Manual-install examples live in `deploy/systemd/`; inspect their `User`, `WorkingDirectory`, executable and dependency paths before copying them. The bot unit requires the optional daemon by default; remove that dependency if using only executable fallback.

For `/etc/rhapsod.env`, add an override with `sudo systemctl edit rhapsod`:

```ini
[Service]
EnvironmentFile=/etc/rhapsod.env
ReadWritePaths=/etc/rhapsod.env
```

The service user needs write permission on that file for panel edits. Use `RestartPreventExitStatus=42` so duplicate-instance rejection does not cause a restart loop. Confirm `ExecStart` uses the path reported by `command -v node`.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now rhapsod-ytdlp-daemon rhapsod
journalctl -u rhapsod -n 100 --no-pager
```

The daemon uses `scripts/yt-dlp-daemon.py`, Python's `yt-dlp[default]` package and optional extraction plugins. Its default address is `127.0.0.1:8765`; set `RHAPSOD_YTDLP_DAEMON_URL=http://127.0.0.1:8765`. It falls back to the executable when unavailable. Set `RHAPSOD_MAX_CONCURRENT_YTDLP_JOBS` to 1-4 only when overriding the CPU-adaptive default.

## Panel access and idle check

```bash
ssh -N -L 8080:127.0.0.1:8080 user@host
```

Open `http://127.0.0.1:8080`. Before a restart, query the authenticated state endpoint from the host or through the tunnel; curl prompts for the password:

```bash
curl --fail --user admin http://127.0.0.1:8080/api/state
```

Wait for `playerState` to be `idle`. Paused and buffering sessions also represent active use. If the panel is disabled, coordinate an idle window with channel users and check `!np`.

## Backup, update and rollback

Record the current commit with `git rev-parse HEAD`. During an idle maintenance window, stop the bot and archive the actual data and configuration paths so the backup is consistent:

```bash
sudo systemctl stop rhapsod
sudo tar -czf /root/rhapsod-backup.tar.gz /var/lib/rhapsod /etc/rhapsod.env
```

For installer layouts, use `/home/rhapsod/rhapsod/data`, `/home/rhapsod/rhapsod/.env` and the configured cookie file instead. Store backups privately.

For a tagged installation, replace `<release-tag>` with the selected published tag:

```bash
git fetch --tags origin
git checkout --detach <release-tag>
npm ci
npm run build
sudo systemctl restart rhapsod-ytdlp-daemon rhapsod
```

For a deployment already tracking `main`, use `git pull --ff-only` instead of the checkout. Review the release notes first, particularly when crossing a major version. Do not use the installer as the routine update mechanism.

Verify `systemctl is-active rhapsod`, the panel version, a test track, queue advancement and saved preferences. Inspect `journalctl -u rhapsod -n 100 --no-pager` for errors. To roll back, stop while idle, check out the recorded commit, run `npm ci` and `npm run build`, restore the matching backup if a data migration requires it, and restart.

## Docker Compose (Linux)

The Compose file starts separate bot and yt-dlp containers using Linux host networking. Both services bind to localhost; no panel port is published. This layout also lets the bot reach a TeamSpeak server or optional extraction services on the host.

Prepare `.env` and set container paths:

```dotenv
RHAPSOD_DATA_DIR=/app/data
RHAPSOD_YTDLP_PATH=yt-dlp
RHAPSOD_FFMPEG_PATH=/usr/bin/ffmpeg
RHAPSOD_FFPROBE_PATH=/usr/bin/ffprobe
RHAPSOD_YTDLP_COOKIES_PATH=/app/data/youtube-cookies.txt
```

Create `data/` and place a cookie file there if required. The bot mounts data read/write; the daemon reads it read-only. `.env` is mounted for panel edits; recreate containers after changing environment values because Compose injects them at container creation. Optional WARP/POT services are configured separately on the host.

```bash
docker compose config --quiet
docker compose up -d --build
docker compose logs --tail=100 rhapsod ytdlp
```

For updates, check idle state, back up data, fetch the chosen source revision and run `docker compose up -d --build --force-recreate`. The image installs Python dependencies in a virtual environment and excludes development npm packages from runtime.

## Multiple instances

`RHAPSOD_INSTANCE_ID=blue` moves persistent files under `<RHAPSOD_DATA_DIR>/instances/blue/`. Each process needs a unique ID, TeamSpeak identity and panel port. Do not point two processes at the same instance directory.

```bash
sudo cp deploy/systemd/rhapsod@.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rhapsod@blue
```

Create `/etc/rhapsod-blue.env` first and inspect the template paths. The template sets the instance ID from its unit name. Several instances may share one daemon. A duplicate nickname or identity at initial connection causes exit code 42; inspect logs before starting again.
