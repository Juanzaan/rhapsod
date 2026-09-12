# Architecture

[Español](architecture.es.md)

Rhapsod is a Node.js ESM application. `src/main.ts` assembles configuration, persistence, providers, playback, commands, the TeamSpeak adapter and the optional Hono panel.

```text
TeamSpeak chat / local panel
             |
Command registry, permissions and rate limits
             |
Playback service -> TrackQueue -> PlaybackController
             |                         |
Media providers -> PreparedAudioStore -> FFmpeg PCM
                                       |
                              Opus / frame scheduler
                                       |
                              TeamSpeak voice adapter
```

## Boundaries

- `src/application/`: intake, queue ownership, playback controller, staleness epochs, prepared URLs, playlists, preferences and listening history.
- `src/audio/`: FFmpeg processes, PCM buffering, loudness profiles, effects, Opus encoding and frame scheduling.
- `src/media/`: provider metadata, URL resolution, searches, ranking, radio and lyrics.
- `src/adapters/ts3/`: voice connection, reconnection, talk power, identity and probes.
- `src/commands/`: command metadata, handlers, permissions and chat responses.
- `src/panel/`: authenticated localhost HTTP endpoints, templates and environment-file editing.
- `src/observability/`: structured logs, playback metrics and sanitized errors.
- `src/config.ts`: runtime schema and default settings.

## Playback and providers

Metadata is resolved at intake; temporary stream URLs are prepared near playback. `PreparedAudioStore` deduplicates lookups and manages expiry and cancellation. `PlaybackEpoch` invalidates stale asynchronous work after transport actions. `PlaybackController` serializes advancement and bounds resolution time.

YouTube uses Innertube and yt-dlp paths, optionally through a persistent Python daemon. SoundCloud uses its public web interface with fallback resolution. Spotify supplies metadata only; SongLink maps supported music-service links to available sources. Direct audio accepts public HTTPS inputs. Outbound checks reject private addresses and pin hostname resolution at connection time.

FFmpeg produces 48 kHz stereo PCM. Opus encodes 20 ms frames within the 497-byte audio payload budget; the TS3 wire codec is Opus Music (5). The scheduler uses monotonic deadlines and sends silence during underruns. Prewarm prepares the next FFmpeg stream and loudness profile before handoff.

## Persistence and personalization

State lives under `RHAPSOD_DATA_DIR`, optionally namespaced by `RHAPSOD_INSTANCE_ID`. JSON stores use temporary-file replacement and serialized or debounced writes. Shutdown waits for pending writes. Read-only or unused stores must not overwrite existing data during shutdown.

Listening history supplies per-user and global statistics and autoplay ranking signals. Session weighting expires after inactivity; older plays decay. Track-history limits apply in memory and on disk. Title-derived energy is a ranking heuristic, not audio analysis.

## Owner surface

The panel remains bound to `127.0.0.1` behind basic authentication and is reached through SSH. It edits only permitted settings and writes cookie files locally when requested. Secrets therefore exist in local runtime files; logs and API summaries must redact them. Panel-only setup mode does not connect the bot to TeamSpeak.

## Verification and extension

Run `npm run check` and `npm run test:coverage`. Provider and TeamSpeak tests use controlled substitutes; live audio and deployment checks remain necessary in the target environment. TeamSpeak 6 is planned and must preserve the application-facing connection contract.
