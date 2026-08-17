# Roadmap

## Phase 1: TeamSpeak 3 foundation

- Connect a headless voice client to a configured channel.
- Stream a local audio file through FFmpeg and Opus.
- Reconnect with bounded exponential backoff.
- Expose health and connection state.

## Phase 2: Usable music bot

- Chat commands for play, pause, resume, skip, stop, queue, and volume.
- URL validation and configurable source allowlists.
- User and server-group permissions.
- Persistent queue and settings.

## Phase 3: Operations

- Container image and documented deployment.
- Structured metrics and operational runbook.
- Multiple bot instances with isolated configuration.

## Phase 4: TeamSpeak 6

- Implement the TS6 voice adapter behind the existing `VoiceClient` port.
- Run the shared behavior suite against TS3 and TS6.
- Publish a compatibility and migration guide.
