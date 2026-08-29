# Deployment

Rhapsod is a persistent service. It needs a machine or container that stays
online, has outbound UDP access to the TeamSpeak 3 voice port, and can run
Node.js, `yt-dlp`, and FFmpeg.

## Release profiles

The 1.x line is the low-end stable profile. `v1.0.0` through `v1.2.1` are
intended to run on a VPS with 1 vCPU and 1 GB RAM; `v1.2.1` is the latest
stable release in that line.

The 2.x line is under development for the OCI production profile with 4 vCPUs
and 3 GB RAM. Do not treat the 2.x branch as stable until a 2.x release is
published.

The yt-dlp queue derives its baseline concurrency from the available CPUs, so
the same 1.x build remains usable on smaller machines. Resource increases in
2.x should be measured rather than assumed.

`RHAPSOD_MAX_CONCURRENT_YTDLP_JOBS` can override the adaptive default from 1 to 4. For the OCI production profile (4 vCPU / 3 GB) set it to `4`: yt-dlp jobs are I/O-bound, so the extra workers reduce sequential wait without stressing the CPUs. Measure child-process RSS and audio health after any change; the schema caps the value at 4.

## Remote access

The current production VM runs on OCI. During initial setup, connect as
`opc` using the SSH key selected at instance creation and the assigned public
IP:

```bash
ssh -i ~/.ssh/rhapsod-vm-key.pem opc@<OCI_PUBLIC_IP>
```

The bootstrap script copies that key to the `rhapsod` service account, so
subsequent administration can use:

```bash
ssh -i ~/.ssh/rhapsod-vm-key.pem rhapsod@<OCI_PUBLIC_IP>
```

The legacy Azure low-end VM is reachable through the Tailscale tailnet only.
Its SSH rule allows port 22 solely from `100.64.0.0/10`.

```bash
ssh -i ~/.ssh/rhapsod-vm-key.pem rhapsod@100.80.92.115
```

To re-enable a machine, install Tailscale, sign in to the same tailnet
(`Juanzaan@`), and run `tailscale up`.

## The bot identity

On its first start Rhapsod generates a TeamSpeak client identity and stores it
at `$RHAPSOD_DATA_DIR/ts3-identity.txt`. This private identity makes the bot
appear as the same TeamSpeak user after restarts.

- Persist `RHAPSOD_DATA_DIR` on a host volume.
- Do not commit or share `ts3-identity.txt`.
- Create a dedicated TeamSpeak server group for the bot.
- Grant only permission to join the target channel, speak, and use channel chat.

## Required configuration

```dotenv
RHAPSOD_TS3_HOST=voice.example.com
RHAPSOD_TS3_PORT=9987
RHAPSOD_TS3_NICKNAME=Rhapsod
RHAPSOD_TS3_CHANNEL_NAME=Music
RHAPSOD_DATA_DIR=/var/lib/rhapsod
RHAPSOD_YTDLP_PATH=/usr/local/bin/yt-dlp
RHAPSOD_YTDLP_COOKIES_PATH=
RHAPSOD_FFMPEG_PATH=/usr/bin/ffmpeg
```

`RHAPSOD_TS3_PASSWORD` is the optional server password. Use
`RHAPSOD_TS3_CHANNEL_PASSWORD` only when the target channel is protected.

Spotify track links in `!play` are optional. Create an app at
<https://developer.spotify.com/dashboard> (Web API access; any HTTPS redirect
URI works, it is never used), then set:

```dotenv
RHAPSOD_SPOTIFY_CLIENT_ID=
RHAPSOD_SPOTIFY_CLIENT_SECRET=
```

The bot uses the client credentials flow only: no user login, no user data.
When these variables are missing, Spotify links fail with a clear message.

## systemd

Rhapsod runs as two systemd services: the bot itself and a persistent yt-dlp
daemon that resolves YouTube audio URLs fast (a single warm `YoutubeDL` process
instead of a per-call Python startup). The repo ships both unit files,
`rhapsod.service` and `rhapsod-ytdlp-daemon.service`, plus a
`deploy-rhapsod.sh` script that rebuilds from the stable tag and restarts both.

The daemon needs the `yt-dlp[default]` Python package installed into its
`PYTHONPATH` (see `oci-cloud-init.sh` for the reference setup). It listens on
`127.0.0.1:8765` and reads the bot's cookies file, so the bot can reach it via
`RHAPSOD_YTDLP_DAEMON_URL=http://127.0.0.1:8765`.

Example production bot unit (adjust the environment values for your server):

```ini
[Unit]
Description=Rhapsod TeamSpeak music bot
After=network-online.target rhapsod-ytdlp-daemon.service
Wants=network-online.target
Requires=rhapsod-ytdlp-daemon.service

[Service]
Environment=RHAPSOD_TS3_HOST=voice.example.com
Environment=RHAPSOD_TS3_PORT=9987
Environment=RHAPSOD_TS3_NICKNAME=Rhapsod
Environment=RHAPSOD_TS3_CLIENT_DESCRIPTION=Rhapsod - [url=https://github.com/Juanzaan/rhapsod]github.com/Juanzaan/rhapsod[/url]
Environment=RHAPSOD_DATA_DIR=/var/lib/rhapsod
Environment=RHAPSOD_YTDLP_PATH=/usr/local/bin/yt-dlp
Environment=RHAPSOD_YTDLP_COOKIES_PATH=/home/rhapsod/youtube-cookies.txt
Environment=RHAPSOD_YTDLP_DAEMON_URL=http://127.0.0.1:8765
Environment=RHAPSOD_FFMPEG_PATH=/usr/bin/ffmpeg
Environment=RHAPSOD_SPOTIFY_CLIENT_ID=
Environment=RHAPSOD_SPOTIFY_CLIENT_SECRET=
Type=simple
User=rhapsod
WorkingDirectory=/home/rhapsod/rhapsod
ExecStart=/usr/bin/node dist/main.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=15
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
MemoryMax=512M
MemorySwapMax=1G

[Install]
WantedBy=multi-user.target
```

Example daemon unit (shipped as `rhapsod-ytdlp-daemon.service`):

```ini
[Unit]
Description=Rhapsod yt-dlp audio resolution daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=rhapsod
ExecStart=/usr/bin/python3 /home/rhapsod/rhapsod/scripts/yt-dlp-daemon.py
Environment=PYTHONPATH=/home/rhapsod/ytdlp-deps
Environment=RHAPSOD_YTDLP_COOKIES_PATH=/home/rhapsod/youtube-cookies.txt
Restart=on-failure
RestartSec=5
RuntimeMaxSec=86400
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
MemoryHigh=512M
MemoryMax=768M
MemorySwapMax=0
TasksMax=64

[Install]
WantedBy=multi-user.target
```

`RHAPSOD_TS3_CLIENT_DESCRIPTION` sets the bot's client description, which
any client can set for itself — no server permissions required. BBCode is
allowed (e.g. `[url=...]...[/url]`). `RHAPSOD_DATA_DIR` persists the TS3
identity: give the unit a matching `StateDirectory=rhapsod` (and
`Environment=RHAPSOD_DATA_DIR=/var/lib/rhapsod`) so the identity survives
restarts.

Rhapsod also loads a `.env` file from its working directory (`dotenv/config`),
so non-secret runtime config can live there. Secrets such as the Spotify
credentials and the yt-dlp cookies file must not be committed.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now rhapsod-ytdlp-daemon rhapsod
journalctl -u rhapsod -f
```

The process handles `SIGINT` and `SIGTERM` by disconnecting from TeamSpeak
cleanly. After a runtime disconnect or kick, it retries at most five times,
with a five-second delay, then flushes its state and exits. `TimeoutStopSec=15`
gives the shutdown sequence room; `Restart=on-failure` recovers crashes without
restarting after the intentional reconnect-limit shutdown. On
resource-constrained VMs, keep the `MemoryMax=` / `MemorySwapMax=` limits (see
issue #8) and watch journald logs for `underruns` / `rebufferEvents`.
