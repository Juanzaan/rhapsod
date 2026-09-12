# Install

[Español](install.es.md)

Use an always-on Linux host with outbound UDP access to TeamSpeak. The installer supports x86_64 Ubuntu 20.04+, Debian 11+ and RHEL-family 9+ systems. Resource use depends on queue size and extraction concurrency; measure FFmpeg and yt-dlp memory alongside the Node process.

## VPS installer

```bash
curl -fsSL https://raw.githubusercontent.com/Juanzaan/rhapsod/main/install.sh | sudo bash
```

The installer selects the latest stable tag, installs Node 22 when absent, yt-dlp, FFmpeg, the Python daemon and optional extraction services, then creates systemd units. An existing Node installation must be >=22.19.0. New installs receive `.env`, an empty cookie file and a generated panel password; reruns preserve existing configuration and cookies.

The bot starts in panel-only mode with `RHAPSOD_TS3_AUTO_CONNECT=false`. Open a tunnel:

```bash
ssh -N -L 8080:127.0.0.1:8080 user@host
```

Open `http://127.0.0.1:8080/setup`, sign in with the printed credentials and configure TeamSpeak, channel, audio and YouTube. Saving TeamSpeak settings enables auto-connect for the next start. Keep the panel on `127.0.0.1`.

Installer overrides are `RHAPSOD_REF`, `RHAPSOD_APP_DIR`, `RHAPSOD_USER` and `RHAPSOD_SKIP_WARP=1`. Pass them to the privileged shell explicitly, for example:

```bash
curl -fsSL https://raw.githubusercontent.com/Juanzaan/rhapsod/main/install.sh -o /tmp/rhapsod-install.sh
sudo env RHAPSOD_SKIP_WARP=1 bash /tmp/rhapsod-install.sh
```

The installer configures a weekly yt-dlp updater. Rhapsod itself is updated separately using the [deployment procedure](deployment.md).

## Manual install

Install Node.js >=22.19.0, yt-dlp, FFmpeg and ffprobe, then:

```bash
git clone https://github.com/Juanzaan/rhapsod.git
cd rhapsod
npm ci
cp .env.example .env
```

Set `RHAPSOD_TS3_HOST`. For browser-first setup also set:

```dotenv
RHAPSOD_TS3_AUTO_CONNECT=false
RHAPSOD_PANEL_ENABLED=true
RHAPSOD_PANEL_HOST=127.0.0.1
RHAPSOD_PANEL_PASSWORD=replace-with-a-unique-password
```

```bash
npm run build
npm start
```

Use `RHAPSOD_YTDLP_PATH`, `RHAPSOD_FFMPEG_PATH` and `RHAPSOD_FFPROBE_PATH` when tools are outside PATH. The optional daemon listens at `127.0.0.1:8765`; configure `RHAPSOD_YTDLP_DAEMON_URL` only when it is running. See [deployment](deployment.md) for services and Docker.

## Verify

```bash
node --version
yt-dlp --version
ffmpeg -version
ffprobe -version
```

Confirm the bot joins its channel, request a track with `!play` and inspect `!stats`. For installer deployments, inspect `systemctl status rhapsod rhapsod-ytdlp-daemon` and `journalctl -u rhapsod -n 100 --no-pager`.

## Troubleshooting

- Connection failure: verify host, voice port, server/channel password and speaking permissions. The setup wizard can probe connectivity.
- YouTube failure: update yt-dlp using its installation method and inspect the panel's YouTube health result. When authentication is required, configure a permitted account's cookie file through the wizard or `RHAPSOD_YTDLP_COOKIES_PATH`.
- Settings save failure: `RHAPSOD_ENV_FILE` must point to a file writable by the service user. For `/etc/rhapsod.env` under `ProtectSystem=full`, grant `ReadWritePaths=/etc/rhapsod.env` in a systemd override and suitable file ownership.
- Data permission failure: the service user must own `RHAPSOD_DATA_DIR` and be able to create temporary files beside the persisted JSON files.

After unit changes, run `sudo systemctl daemon-reload`; wait for idle playback before restarting.
