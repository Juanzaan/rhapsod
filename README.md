# Rhapsod

Rhapsod is a self-hosted music bot for TeamSpeak 3. The project starts with TS3
and keeps the voice transport isolated so TeamSpeak 6 support can be added once
the TS3 implementation is stable.

> [!IMPORTANT]
> Rhapsod is in its foundation phase. Configuration and queue behavior are
> implemented; the TS3 voice adapter is the next milestone.

## Requirements

- Node.js 22.12 or newer
- npm 10 or newer
- A TeamSpeak 3 server and permission for the bot to join and speak

FFmpeg will be provided as a project dependency; a global installation is not
required.

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
- [Roadmap](docs/roadmap.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## License

Rhapsod is licensed under the MIT License. TeamSpeak is a trademark of
TeamSpeak Systems GmbH. Rhapsod is not affiliated with or endorsed by TeamSpeak.
