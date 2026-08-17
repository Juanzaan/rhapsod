# Architecture

Rhapsod separates music playback from the voice protocol so TeamSpeak 6 can be
added without replacing the application core.

```text
Chat commands / future Web API
              |
        Application services
        /                 \
Playback queue         Permissions
        |                   |
    AudioSource          User identity
        |
FFmpeg / media resolver
        |
     VoiceClient
        |
TeamSpeak 3 adapter (TeamSpeak 6 adapter later)
```

## Boundaries

- `domain` contains deterministic business rules and no external dependencies.
- `ports` defines the contracts used by the application.
- `adapters` will contain TeamSpeak, FFmpeg, persistence, and API integrations.
- Secrets are read from environment variables and never persisted by Rhapsod.

## TeamSpeak 3

ServerQuery can administer a server and receive events, but it cannot transmit
voice. The TS3 adapter therefore needs a headless voice client. The first
candidate is `@honeybbq/teamspeak-client`; its API and behavior will be covered
by an integration test before it becomes part of the stable boundary.

## Compatibility

TS3-specific packet and identity details must remain inside its adapter. The
queue, permissions, media resolution, commands, and persistence cannot import
TS3 implementation types.
