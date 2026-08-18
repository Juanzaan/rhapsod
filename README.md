# Rhapsod

Rhapsod is a self-hosted music bot for TeamSpeak 3. The project starts with TS3
and keeps the voice transport isolated so TeamSpeak 6 support can be added once
the TS3 implementation is stable.

> [!IMPORTANT]
> Rhapsod is in its foundation phase. TS3 voice transport, buffered Opus
> playback, YouTube queueing, and the audio test tone are implemented. Real
> server validation is still required before calling the TS3 milestone stable.

## Requirements

- Node.js 22.12 or newer
- npm 10 or newer
- `yt-dlp` available on `PATH` or configured through `RHAPSOD_YTDLP_PATH`
- A TeamSpeak 3 server and permission for the bot to join and speak

FFmpeg is bundled as a fallback for development, but a system installation is
recommended in production. Set `RHAPSOD_FFMPEG_PATH=/usr/bin/ffmpeg` on Linux
when the bundled binary is incompatible with the host CPU or libc.

The YouTube resolver uses the configured private cookies file and yt-dlp's
official EJS challenge solver for datacenter-friendly extraction. Keep both
the cookies file and its path out of Git.

The YouTube resolver, chat command parser, FFmpeg PCM pipeline, Opus encoder,
queue controls, and TS3 voice adapter are implemented. Set
`RHAPSOD_AUDIO_TEST_TONE_SECONDS=3` to validate voice permissions and audio
transport before testing YouTube playback.

YouTube extraction may require a private cookies file and yt-dlp's EJS
challenge solver when the bot runs from a datacenter IP. Cookies are secrets:
keep them outside Git and use a dedicated account.

For servers that publish a TeamSpeak SRV record, query the port with:

```powershell
Resolve-DnsName _ts3._udp.example.com -Type SRV
```

For HolyPVP, the published TS3 voice port is currently `10569`; configure
`RHAPSOD_TS3_HOST=ts.holypvp.net` and `RHAPSOD_TS3_PORT=10569` in your local
`.env`. Do not commit that file or any TS3 identity generated under `data/`.

## Development

```bash
npm install
cp .env.example .env
npm run dev
```

Run every quality gate with `npm run check`.

## Configuration

Copy `.env.example` to `.env` and set the TS3 host. Passwords and other secrets
must only exist in `.env` or the deployment secret store.

## Documentation

- [Architecture](docs/architecture.md)
- [Commands](docs/commands.md)
- [Deployment](docs/deployment.md)
- [Roadmap](docs/roadmap.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## License

Rhapsod is licensed under the MIT License. TeamSpeak is a trademark of
TeamSpeak Systems GmbH. Rhapsod is not affiliated with or endorsed by TeamSpeak.
