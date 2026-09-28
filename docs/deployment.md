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

The installer creates units appropriate to its paths. Manual-install examples live in `deploy/systemd/`; inspect their `User`, `WorkingDirectory`, executable and dependency paths before copying them. The bot unit wants the optional daemon (`Wants=`): it starts it when present and keeps running on the executable fallback when it stops.

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

The units isolate kernel tunables, devices, namespaces and capabilities and filter syscalls to `@system-service`; file access is not narrowed. Review the result with `systemd-analyze security rhapsod`. If a service logs `Operation not permitted` after an update, check `journalctl` for the blocked call before relaxing the unit with `sudo systemctl edit`.

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

`scripts/deploy.sh` runs the whole procedure below in one command on the host: it waits until the panel reports `playerState: "idle"`, stops the bot, backs up `data/` and the env file, checks out the target, runs `npm ci` and the build as the service user, starts the bot and waits until it stays active and the panel answers. If the build or the start fails, it checks out the previous commit, rebuilds and starts it, and exits with an error. It restarts the yt-dlp daemon only when its script changed and warns when unit templates changed.

```bash
sudo bash scripts/deploy.sh --dry-run
sudo bash scripts/deploy.sh
sudo bash scripts/deploy.sh --ref v4.0.0
```

The default target is `origin/main`; `--ref` accepts a branch, tag or commit. The idle check reads the panel settings from `APP_DIR/.env` (`--env-file` for `/etc/rhapsod.env`); without an enabled panel it refuses to restart unless `--force` is given. Backups go to `APP_DIR/../backups` (`--backup-dir`), private to root, keeping the newest five (`--keep`). Entries are relative, so a restore is `tar -xzf <backup> -C /home/rhapsod/rhapsod` for `data/` and `.env`. It does not restore data on rollback; use the reported backup when a data migration requires it. `--service rhapsod@blue` deploys a named instance.

The manual procedure:

Record the current commit with `git rev-parse HEAD`. During an idle maintenance window, stop the bot and archive the actual data and configuration paths so the backup is consistent:

```bash
sudo systemctl stop rhapsod
sudo tar -czf /root/rhapsod-backup.tar.gz /var/lib/rhapsod /etc/rhapsod.env
```

For installer layouts, use `/home/rhapsod/rhapsod/data`, `/home/rhapsod/rhapsod/.env` and the configured cookie file instead. Store backups privately: they hold per-user data, described in [data and privacy](privacy.md).

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

When a data file (playlists, favorites, listening history, song library, telemetry or playback state) cannot be read at startup because it is not valid JSON or has an unknown format version, the bot renames it to `<name>.corrupt-<UTC time>` in the same directory, logs a warning with both names and starts that store empty. Nothing is deleted. List set-aside files with `ls /var/lib/rhapsod/*.corrupt-*`. To recover one, stop the bot while idle, repair the copy or take the file from the backup, move it back to its original name and start the bot.

## Playback indicators

Every finished track logs a `Playback session` line with its latency: `startDelayMs` (from picking the track to its first audio frame), `handoffGapMs` (silence after the previous track, absent after the bot sat idle), `coldStart`, `prewarmed`, underruns and rebuffers. Summarize them from the log directory:

```bash
cd /var/lib/rhapsod
node /home/rhapsod/rhapsod/scripts/log-stats.mjs --since 2026-09-01T00:00:00Z logs/*.log
```

The "Indicadores de reproducción" block reports p50, p90 and p99 for the time from a command to the first audio on a cold start, the gap between tracks, and underruns per track, plus the share of handoffs that used the prewarmed stream. Compare the same window before and after an update.

The panel also serves the same counters and latency histograms live at `GET /api/metrics` in Prometheus text format, behind the panel's basic auth and loopback bind. A Prometheus running on the same host scrapes it with:

```yaml
scrape_configs:
  - job_name: rhapsod
    metrics_path: /api/metrics
    basic_auth:
      username: admin
      password_file: /etc/prometheus/rhapsod-panel-password
    static_configs:
      - targets: ["127.0.0.1:8080"]
```

`rhapsod_play_start_delay_seconds` and `rhapsod_handoff_gap_seconds` are histograms; `rhapsod_plays_total{reason="error"}` and `rhapsod_underruns_total` are counters. Counters restart at zero when the bot restarts.

`rhapsod_frame_tick_lateness_seconds` is a histogram of how late each 20 ms audio tick fired, and `rhapsod_clock_slips_total` counts ticks more than one frame late, where the audio clock dropped its schedule. Both are added when a play ends. A rising slip count while nothing else changed means the host could not keep up (CPU steal on a shared VPS, a garbage collection pause); the same numbers per play are in the `Playback session` log line under `clockTiming`.

`rhapsod_inter_track_gap_seconds` is the silence from one track's last audio frame to the next track's first; today it sits near 320 ms, the prebuffer the next track waits for. `rhapsod_command_to_first_audio_seconds` measures from a request to its first audio frame, only when nothing else was playing. `scripts/log-stats.mjs` reports both from the `Playback session` lines (`interTrackGapMs`, `commandToFirstAudioMs`).

To see which stage a slow start spent its time in, the `Playback session` line splits it: `metadataMs` (search or link lookup before the track is queued), `urlWaitMs` (stream URL, near 0 when `prefetchStatus` is `hit`), `segmentsWaitMs` (SponsorBlock lookup, only with `RHAPSOD_SKIP_NON_MUSIC=true`), `firstFrameDelayMs` (ffmpeg start to first frame) and `autoplayPickMs` (time autoplay took to choose the track once the queue ran dry). `audioUrlMs` is the longer of `urlWaitMs` and `segmentsWaitMs`, since both run at once. `node scripts/log-stats.mjs` prints each one with p50/p95, and the stream URL time per resolver (innertube, daemon, local yt-dlp) from the `Audio URL resolved` lines.

`rhapsod_delivered_loudness_lufs` and `rhapsod_delivered_true_peak_dbtp` bucket what each play actually sent, measured with ITU-R BS.1770 (K-weighted, gated integrated loudness and 4x oversampled true peak) on the frames before the `!volume` gain. Compare them with `RHAPSOD_LOUDNESS_TARGET_LUFS` (default -14) and the -1.5 dBFS limiter ceiling: many plays with a true peak above -2 dBTP mean the limiter works often. The same reading is in the `Playback session` log line as `delivered`, and `scripts/log-stats.mjs` summarizes it. Metering adds about 0.24 ms of CPU per 20 ms frame.

With a yt-dlp daemon configured, `rhapsod_ytdlp_daemon_up` drops to 0 while the daemon fails and `rhapsod_ytdlp_daemon_fallbacks_total` counts resolves that spawned yt-dlp instead. Songs still play in that state, only slower to start; the bot logs `yt-dlp daemon failed` at most once a minute and the daemon writes each failure to its journal (`journalctl -u rhapsod-ytdlp-daemon`).

`GET /api/health` answers 503 while the bot is reconnecting to TeamSpeak and 200 otherwise. Its body also reports `reconnecting`, `youtubeAuthHealthy` and `ytdlpDaemon`; those two degrade the body but not the status code, so `scripts/deploy.sh` does not roll back over an expired YouTube login. The body also carries `verdict` from the open notices (`ok`, `degraded` with an error notice, `unhealthy` with a critical one; ignored notices do not count) and `openNotices`. The verdict never changes the status code either: a persistent critical notice would otherwise roll back every deploy, including the one that fixes it. `rhapsod doctor` warns on `degraded` and fails on `unhealthy`.

## Docker Compose (Linux)

The Compose file runs the multi-architecture image `ghcr.io/juanzaan/rhapsod` (linux/amd64 and linux/arm64) as separate bot and yt-dlp containers, plus the bgutil POT provider, all on Linux host networking. Every service binds to localhost; no panel port is published. This layout also lets the bot reach a TeamSpeak server or optional extraction services on the host.

The image is published from the first release after v4.0.0 on. Until then `docker compose pull` fails with `denied`, and the image has to be built from a checkout, or the bot installed with `install.sh` instead:

```bash
git clone https://github.com/Juanzaan/rhapsod.git && cd rhapsod
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
docker compose logs rhapsod
```

Once a release lists the image, copy `docker-compose.yml` to an empty directory and start it:

```bash
docker compose up -d
docker compose logs rhapsod
```

The first start needs no `.env`. The bot's container writes `data/.env` inside the `rhapsod-data` volume with container paths, boots the panel-only setup mode and prints `panel login admin / <password>` once to its log. Set `RHAPSOD_TS3_HOST` under the `rhapsod` service's `environment:` before the first start to join TeamSpeak right away instead; the bot then logs the `!claim` code. Open the panel through an SSH tunnel as in [installation](install.md), and load cookies through its YouTube step when needed.

`RHAPSOD_VERSION` picks the image tag: `4` (default) follows 4.x releases, `4.1` stays on one minor, `4.1.2` pins a release. Tags are rebuilt every week with the newest yt-dlp. Values under `environment:` override `data/.env`.

The containers run as the unprivileged `node` user (uid 1000), which owns the named volume. Copy files in or out with `docker compose cp`. The image's healthcheck reads the panel with the password from `data/.env`, so `docker compose ps` shows `healthy` only while the panel is enabled and answering; the same checks as the host command run inside the container:

```bash
docker compose exec rhapsod node dist/cli.js status
docker compose exec rhapsod node dist/cli.js doctor
docker compose exec rhapsod node dist/cli.js password
```

WARP stays a host service.

For updates, check idle state, back up the volume and run `docker compose pull && docker compose up -d`. A build from a checkout updates with `git pull` and the `--build` command above.

Installs made with the earlier Compose file kept `.env` and `data/` next to it. Move both into the volume once, with the old containers stopped:

```bash
docker compose down
docker compose run --rm --no-deps -v "$PWD:/old:ro" --entrypoint sh rhapsod \
  -c 'cp -a /old/data/. /app/data/ && cp /old/.env /app/data/.env'
docker compose up -d
```

## Multiple instances

`RHAPSOD_INSTANCE_ID=blue` moves persistent files under `<RHAPSOD_DATA_DIR>/instances/blue/`. Each process needs a unique ID, TeamSpeak identity and panel port. Do not point two processes at the same instance directory.

```bash
sudo cp deploy/systemd/rhapsod@.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rhapsod@blue
```

Create `/etc/rhapsod-blue.env` first and inspect the template paths. The template sets the instance ID from its unit name. Several instances may share one daemon. A duplicate nickname or identity at initial connection causes exit code 42; inspect logs before starting again.
