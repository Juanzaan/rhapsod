# Roadmap

## Current savepoint

Rhapsod tiene una base estable para TeamSpeak 3, reproducción YouTube,
resolución SoundCloud y operación en la VPS. El siguiente objetivo es mejorar
la selección de canciones antes de agregar recomendaciones personalizadas.

## Phase 1: TeamSpeak 3 foundation

- Connect a headless voice client to a configured channel.
- Stream a local audio file through FFmpeg and Opus.
- Reconnect with bounded exponential backoff.
- Expose health and connection state.

## Phase 2: Usable music bot

- Chat commands for play, pause, resume, skip, stop, queue, and queue editing.
- URL validation and configurable source allowlists.
- User and server-group permissions.
- Persistent queue and settings.

## Phase 2.5: Multi-source resolution and search quality

- Define a shared resolver contract for YouTube, SoundCloud, and Spotify.
- Search multiple YouTube candidates instead of accepting `ytsearch1` blindly.
- Rank candidates by title, artist, duration, channel, and version penalties.
- Reject low-confidence results instead of queueing unrelated videos.
- Preserve SoundCloud metadata when a track is blocked or DRM protected.
- Search YouTube by SoundCloud/Spotify metadata only as a controlled fallback.
- Cache alternative resolutions and bound provider timeouts.

Exit criteria: deterministic ranking tests cover official audio, live videos,
covers, remixes, Shorts, ambiguous titles, and no-match results.

## Phase 2.6: Spotify metadata support

- Resolve Spotify track, album, and playlist metadata.
- Keep credentials in the VPS environment, never in Git.
- Use YouTube/SoundCloud only for authorized playback sources.
- Expand playlists with bounded concurrency and cancellation.

Exit criteria: a Spotify track resolves to a high-confidence playable source or
returns a clear no-match message.

## Phase 2.7: Optional user preference signals

- Record minimal per-TS3-user signals: requested artist, completed track, skip,
  and rejected alternative.
- Store only aggregates locally and allow disabling or deleting them.
- Use preferences only as a small ranking adjustment after objective matching.

Exit criteria: personalization never overrides a poor title/artist match and
tests cover empty history, conflicting preferences, and opt-out behavior.

## Phase 3: Operations

- Container image, systemd unit, and documented deployment.
- Structured metrics and operational runbook.
- Multiple bot instances with isolated configuration.

## Phase 4: TeamSpeak 6

- Implement the TS6 voice adapter behind the existing `VoiceClient` port.
- Run the shared behavior suite against TS3 and TS6.
- Publish a compatibility and migration guide.
