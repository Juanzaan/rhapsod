# Deployment

Rhapsod is a persistent service. It needs a machine or container that stays
online, has outbound UDP access to the TeamSpeak 3 voice port, and can run
Node.js, `yt-dlp`, and FFmpeg.

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

The production unit file used by the HolyPVP deployment:

```ini
[Unit]
Description=Rhapsod TeamSpeak music bot
After=network-online.target
Wants=network-online.target

[Service]
Environment=RHAPSOD_TS3_HOST=ts.holypvp.net
Environment=RHAPSOD_TS3_PORT=10569
Environment=RHAPSOD_TS3_NICKNAME=Rhapsod
Environment=RHAPSOD_YTDLP_PATH=/usr/local/bin/yt-dlp
Environment=RHAPSOD_YTDLP_COOKIES_PATH=/home/rhapsod/youtube-cookies.txt
Environment=RHAPSOD_FFMPEG_PATH=/usr/bin/ffmpeg
Environment=RHAPSOD_SPOTIFY_CLIENT_ID=
Environment=RHAPSOD_SPOTIFY_CLIENT_SECRET=
Type=simple
User=rhapsod
WorkingDirectory=/home/rhapsod/rhapsod
ExecStart=/usr/bin/node dist/main.js
Restart=always
RestartSec=5
TimeoutStopSec=15
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
```

Rhapsod also loads a `.env` file from its working directory (`dotenv/config`),
so non-secret runtime config can live there. Secrets such as the Spotify
credentials and the yt-dlp cookies file must not be committed.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now rhapsod
journalctl -u rhapsod -f
```

The process handles `SIGINT` and `SIGTERM` by disconnecting from TeamSpeak
cleanly. `TimeoutStopSec=15` gives the shutdown sequence room; `Restart=always`
recovers crashes. On resource-constrained VMs, consider `MemoryMax=` (see
issue #8) and keep an eye on journald logs for `underruns` / `rebufferEvents`.
