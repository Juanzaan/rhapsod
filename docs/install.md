# Install

[Español](install.es.md)

Use an always-on Linux host with outbound UDP access to TeamSpeak. The installer supports x86_64 and aarch64 (arm64, for example Oracle Cloud Ampere) Ubuntu 20.04+, Debian 11+ and RHEL-family 9+ systems. Resource use depends on queue size and extraction concurrency; measure FFmpeg and yt-dlp memory alongside the Node process.

## VPS installer

```bash
curl -fsSL https://raw.githubusercontent.com/Juanzaan/rhapsod/main/install.sh | sudo bash
```

The installer selects the latest stable tag, installs Node 22 when absent, yt-dlp, FFmpeg, the Python daemon and optional extraction services, then creates systemd units. An existing Node installation must be >=22.19.0. New installs receive `.env`, an empty cookie file and a generated panel password; reruns preserve existing configuration and cookies.

Downloads are checked against the checksums their publishers list: `SHASUMS256.txt` for Node.js, `SHA2-256SUMS` for yt-dlp and the MD5 file of the FFmpeg mirror. A mismatch stops the install; the weekly yt-dlp update keeps the installed binary instead. The POT provider server and its yt-dlp plugin are pinned to the same release. A new service user gets a `nologin` shell; run maintenance commands with `sudo -u rhapsod env PATH="$PATH" <command>`. The `env PATH="$PATH"` part keeps `/usr/local/bin`, where the installer puts Node.js, on the RHEL family, whose sudo leaves it out of the path.

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

Then restart the daemon and the bot while nothing is playing. A rerun keeps WARP when it is already installed; `RHAPSOD_SKIP_WARP=1` leaves it out. Other installer overrides are `RHAPSOD_REF`, `RHAPSOD_REPOSITORY` (a git URL or local path, for forks and CI), `RHAPSOD_APP_DIR` and `RHAPSOD_USER`.

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

Confirm the bot joins its channel, request a track with `!play` and inspect `!stats`. For installer deployments, run `rhapsod doctor`: it prints one `ok`, `WARN` or `FAIL` line per check (services, Node.js, FFmpeg, yt-dlp, daemon and POT ports, panel bound to loopback, TeamSpeak, YouTube, open notices, disk, clock) and exits non-zero when a check fails.

## The rhapsod command

The installer adds `/usr/local/bin/rhapsod` and records the install in `/etc/rhapsod/install.conf` (`APP_DIR`, `APP_USER`, `NODE_BIN`). It asks for sudo once, since the env file belongs to the service user.

| Command             | Effect                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `rhapsod status`    | Service states, player state, TeamSpeak connection, a pending `!claim` code and the SSH tunnel command for the panel. `--json` for scripts.      |
| `rhapsod doctor`    | The checks above, with the fix for each failure. Prints no secrets.                                                                              |
| `rhapsod password`  | Writes a new random `RHAPSOD_PANEL_PASSWORD` and prints it.                                                                                      |
| `rhapsod restart`   | Restarts the bot when the player is idle, or refuses when the panel cannot tell; `--force` skips the check.                                      |
| `rhapsod logs [N]`  | Follows the bot and daemon journal from N lines back (default 100).                                                                              |
| `rhapsod version`   | Installed version.                                                                                                                               |
| `rhapsod backup`    | Stops the bot for a few seconds and archives `data/` and `.env` to `/home/rhapsod/backups`. Refuses during playback unless `--force`.            |
| `rhapsod update`    | Backs up, installs the latest release (or `--ref REF`), waits for the bot to come up healthy and rolls back on its own if it does not.           |
| `rhapsod rollback`  | Reinstalls the version the last `update` replaced. A second `rollback` goes forward again.                                                       |
| `rhapsod uninstall` | Removes the services, the cron job, `/etc/rhapsod` and the command, after a last backup. `--purge` also removes the `rhapsod` user and its home. |

Without the installer (Docker, manual installs), run the same checks from the checkout: `node dist/cli.js status`, `doctor`, `password` or `version`, with `RHAPSOD_ENV_FILE` pointing at the env file when it is not `./.env`.

### Updates, backups and removal

`rhapsod update` and `rollback` wait until nothing is playing; `backup` refuses during playback. `--force` skips either check. Backups share one folder with `scripts/deploy.sh`; the newest five are kept. To restore one:

```bash
sudo systemctl stop rhapsod
sudo tar -xzf /home/rhapsod/backups/rhapsod-<date>-<commit>.tar.gz -C /home/rhapsod/rhapsod
sudo systemctl start rhapsod
```

`update` replaces the bot's code, not the systemd units or the other components. When the release notes say the installer changed, rerun `install.sh`; it keeps `.env` and the data.

`rollback` restores the code only; the data stays as the newer version left it. When that version changed the data format, restore the backup taken before the update as shown above.

`rhapsod uninstall --purge --yes` runs without a prompt. The last backup goes to `/var/backups/rhapsod`, because `--purge` deletes the home. A service user that can log in (an existing account passed as `RHAPSOD_USER`) is kept with its home; only the checkout is removed. Node.js, FFmpeg, yt-dlp and WARP stay installed, since other software may use them.

## Troubleshooting

- Connection failure: verify host, voice port, server/channel password and speaking permissions. The setup wizard can probe connectivity.
- YouTube failure: update yt-dlp using its installation method and inspect the panel's YouTube health result. When authentication is required, configure a permitted account's cookie file through the wizard or `RHAPSOD_YTDLP_COOKIES_PATH`.
- Settings save failure: `RHAPSOD_ENV_FILE` must point to a file writable by the service user. For `/etc/rhapsod.env` under `ProtectSystem=full`, grant `ReadWritePaths=/etc/rhapsod.env` in a systemd override and suitable file ownership.
- Data permission failure: the service user must own `RHAPSOD_DATA_DIR` and be able to create temporary files beside the persisted JSON files.

After unit changes, run `sudo systemctl daemon-reload`; wait for idle playback before restarting.
