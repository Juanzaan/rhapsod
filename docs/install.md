# Install

Rhapsod needs a machine that stays online with outbound UDP access to the
TeamSpeak 3 voice port. Any mainstream Linux VPS works (Ubuntu, Debian,
RHEL/Oracle Linux/Rocky/Alma) on x86_64 with ~1 GB RAM. Pick a region close
to your TeamSpeak server: voice travels over UDP and latency shows.

## One command (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/Juanzaan/rhapsod/main/install.sh | sudo bash
```

What it does, in order:

1. Detects the distro (`apt` or `dnf`, EPEL on RHEL 9) and installs base
   packages, Node 22, the yt-dlp binary, the daemon Python packages,
   and static FFmpeg.
2. Installs Cloudflare WARP **in proxy mode** (routing and SSH stay
   direct) and enables it on boot. This is the fallback egress the bot
   uses when YouTube rate-limits the datacenter IP. Skip with
   `RHAPSOD_SKIP_WARP=1`.
3. Clones and builds the bgutil POT provider (port 4416) so YouTube
   player requests pass bot checks.
4. Clones the bot at the latest stable tag, installs dependencies,
   and builds it.
5. Writes systemd units (`rhapsod`, `rhapsod-ytdlp-daemon`,
   `bgutil-pot-provider`), an empty `.env` with a **generated panel
   password**, an empty cookies placeholder, and a weekly yt-dlp
   updater cronjob.
6. Enables everything and prints next steps, including the panel login.

Then finish in the browser: open an SSH tunnel
(`ssh -L 8080:127.0.0.1:8080 user@host`), go to
`http://127.0.0.1:8080/setup`, and follow the wizard (TeamSpeak →
channel → audio → **YouTube** → review). The YouTube step tests
playback resolution live and lets you paste `cookies.txt` without
touching the server: export it with the "Get cookies.txt LOCALLY"
browser extension while logged in to youtube.com.

## Manual install

Follow `docs/deployment.md` (reference setup) plus:

- WARP: install `cloudflare-warp`, then `warp-cli mode proxy` **before**
  `warp-cli connect`. Never use full-tunnel mode on a remote server or
  you lose SSH access.
- POT provider: clone
  `https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git`,
  `npm ci && npx tsc` in `server/`, serve `build/main.js` on port 4416,
  and `pip install bgutil-ytdlp-pot-provider` where the daemon runs.
- Point `RHAPSOD_WARP_PROXY=socks5h://127.0.0.1:40000` (bot `.env` and
  daemon unit) to enable the 403 fallback. Empty means direct only.

## Updating

Releases are tags. To update a manual install:

```bash
cd /home/rhapsod/rhapsod
git fetch --tags origin
git checkout --detach <new-tag>
npm ci && npm run build
sudo systemctl restart rhapsod-ytdlp-daemon rhapsod
```

The installer cronjob already keeps yt-dlp fresh weekly.

## Troubleshooting

**Config page empty / saving fails.** The panel reads and writes
`RHAPSOD_ENV_FILE` as the service user. If that file lives under a
read-only path (e.g. `/etc/*.env` combined with `ProtectSystem=full`),
grant access explicitly:

```ini
# /etc/systemd/system/rhapsod.service
ReadWritePaths=/etc/rhapsod.env
```

```bash
sudo chown root:rhapsod /etc/rhapsod.env
sudo chmod 660 /etc/rhapsod.env
sudo systemctl daemon-reload
sudo systemctl restart rhapsod
```

(The installer avoids this entirely by keeping `.env` inside the app dir.)
