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

Run Rhapsod under Docker Compose or systemd. The process handles `SIGINT` and
`SIGTERM` by disconnecting from TeamSpeak cleanly. Deployment manifests will be
added once the audio pipeline is connected.
