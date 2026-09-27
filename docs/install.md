# Install

[Español](install.es.md)

Use an always-on Linux host with outbound UDP access to TeamSpeak. The installer supports x86_64 and aarch64 (arm64, for example Oracle Cloud Ampere) Ubuntu 20.04+, Debian 11+ and RHEL-family 9+ systems. Resource use depends on queue size and extraction concurrency; measure FFmpeg and yt-dlp memory alongside the Node process.

## VPS installer

```bash
curl -fsSL https://raw.githubusercontent.com/Juanzaan/rhapsod/main/install.sh | sudo bash
```

The installer selects the latest stable tag, installs Node 22 when absent, yt-dlp, FFmpeg, the Python daemon and optional extraction services, then creates systemd units. An existing Node installation must be >=22.19.0. New installs receive `.env`, an empty cookie file and a generated panel password; reruns preserve existing configuration and cookies.

Downloads are checked against the checksums their publishers list: `SHASUMS256.txt` for Node.js, `SHA2-256SUMS` for yt-dlp and the MD5 file of the FFmpeg mirror. A mismatch stops the install; the weekly yt-dlp update keeps the installed binary instead. The POT provider server and its yt-dlp plugin are pinned to the same release. A new service user gets a `nologin` shell; run maintenance commands with `sudo -u rhapsod <command>`.

On a new install, the installer first asks for the TeamSpeak server (`ts.example.com` or `ts.example.com:9987`) and its password, if it has one. It asks on the terminal, so this works through `curl | sudo bash` too. At the end, the bot joins that server and the installer prints a one-time code:

```text
The bot is in your TeamSpeak server.
Make yourself its admin: in TeamSpeak, send the bot or its channel
  !claim abcde-fghjk
```

Send `!claim <code>` in TeamSpeak. The first user who sends the right code becomes admin: the bot adds that user's UID to `RHAPSOD_ADMIN_UIDS` in `.env`. The code lives in `data/admin-claim-code` until it is used, survives restarts, and stops working after five wrong attempts until the next restart. With an admin already configured, `!claim` is refused.

Pressing Enter at the question, or running without a terminal, keeps the previous behavior: the bot starts panel-only with `RHAPSOD_TS3_AUTO_CONNECT=false` and TeamSpeak is set in the panel. To configure it without the question, pass the answer:

```bash
curl -fsSL https://raw.githubusercontent.com/Juanzaan/rhapsod/main/install.sh -o "$HOME/rhapsod-install.sh"
sudo env RHAPSOD_TS3_HOST=ts.example.com:9987 RHAPSOD_TS3_PASSWORD=secret bash "$HOME/rhapsod-install.sh"
```

A password with spaces, `#` or quotes cannot go through the installer; set it in the panel.

The panel is optional after that. Open a tunnel from your own computer:

```bash
ssh -N -L 8080:127.0.0.1:8080 user@host
```

Open `http://127.0.0.1:8080/` (or `/setup` when TeamSpeak is not configured yet) and sign in with the printed credentials. Keep the panel on `127.0.0.1`.

Cloudflare WARP is not installed by default. It only helps when YouTube blocks the server's address, which happens on cloud VPS ranges and rarely on a home connection. When that happens, `!stats` says so. Add WARP by running the installer again:

```bash
sudo env RHAPSOD_WITH_WARP=1 bash "$HOME/rhapsod-install.sh"
```

Then restart the daemon and the bot while nothing is playing. A rerun keeps WARP when it is already installed; `RHAPSOD_SKIP_WARP=1` leaves it out. Other installer overrides are `RHAPSOD_REF`, `RHAPSOD_APP_DIR` and `RHAPSOD_USER`.

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

Without `RHAPSOD_ADMIN_UIDS`, the bot writes a `!claim` code to `data/admin-claim-code` and logs it at startup; send `!claim <code>` in TeamSpeak to become admin.

Use `RHAPSOD_YTDLP_PATH`, `RHAPSOD_FFMPEG_PATH` and `RHAPSOD_FFPROBE_PATH` when tools are outside PATH. The optional daemon listens at `127.0.0.1:8765`; configure `RHAPSOD_YTDLP_DAEMON_URL` only when it is running. See [deployment](deployment.md) for services and Docker.

The `RHAPSOD_YTDLP_*_TIMEOUT_MS` keys set yt-dlp timeouts in milliseconds; `.env.example` lists each one with its default and allowed range. The bot refuses to start with a value outside that range, and the panel refuses to save it.

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
