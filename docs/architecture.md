# Architecture

Rhapsod separates music playback from the voice protocol so TeamSpeak 6 can be
added without replacing the application core.

```text
TeamSpeak chat
      |
Command parser and rate limiter
      |
Application services (queue, playback, resolution)
      |                        |
Media resolvers          FFmpeg PCM pipeline
(YouTube / SoundCloud /  (audio URL -> PCM frames)
 Spotify / SongLink)            |
      |                          |
      +---------- Opus encoder --+
                 |
           Frame scheduler
                 |
        TeamSpeak 3 voice adapter
```

## Boundaries

- `src/domain` contains deterministic business rules (queue and track models)
  with no external dependencies.
- `src/adapters` contains the TeamSpeak 3 voice/chat adapter, including the
  client identity store.
- `src/application` wires the playback service: queue, resolution pipeline,
  fallbacks, and timing metrics.
- `src/audio` contains the FFmpeg PCM pipeline, the Opus encoder, the frame
  scheduler, and the audio player.
- `src/media` contains the resolvers (YouTube via yt-dlp, SoundCloud, Spotify),
  the search ranking, the SongLink alternative-source client, and the media
  input parser.
- `src/commands` contains the chat command parser and rate limiter.
- Secrets are read from environment variables and never persisted by Rhapsod.

## Media inputs

The input parser recognizes local files, direct HTTP(S) media URLs, YouTube
videos and playlists, SoundCloud tracks, and Spotify tracks/albums/playlists.
Provider-specific resolution is a separate step. A Spotify URL is metadata, not
an audio stream: the official Spotify Web API does not grant raw audio access.
The Spotify provider resolves track metadata through the client credentials
flow (no user login) and searches YouTube for the matching "artist title"
audio source. Direct Spotify playback would require a separately licensed
Connect/librespot backend.

## TeamSpeak 3

ServerQuery can administer a server and receive events, but it cannot transmit
voice. The TS3 adapter therefore uses a headless voice client,
`@honeybbq/teamspeak-client`, with a thin adapter (`src/adapters/ts3`) that
exposes only the connection contract the application needs.

Rhapsod sends 48 kHz stereo PCM in 20 ms frames through Opus Music (codec 5).
The encoder enforces the 500-byte TS3 packet budget before the adapter sends a
frame, and the scheduler uses monotonic absolute deadlines to avoid drift. The
player begins with a short PCM prebuffer and keeps the frame flow alive during
underruns by sending silence frames, recovering as soon as real audio is
available. Playback metrics include the delay until the first real audio frame
and whether the session completed, was skipped, was stopped, or failed.

Media resolver jobs are serialized so CPU-heavy `yt-dlp` processes cannot run
in parallel and interfere with real-time audio. Playback URL jobs take priority
over metadata jobs that are still waiting in the resolver queue.

SoundCloud uses an isolated public-web adapter. It follows `on.soundcloud.com`
redirects, discovers and caches the current web client identifier, resolves
authorized transcodings, and refreshes the identifier after an API `401`. The
adapter is unofficial and may change with SoundCloud's frontend, so `yt-dlp`
remains a fallback. When either provider reports DRM or a blocked track, the
optional SongLink adapter looks for a YouTube alternative, and a final
metadata-based YouTube search is used as a controlled fallback. Rhapsod never
tries to bypass DRM and rejects the track when no authorized source is
available.

## Compatibility

TS3-specific packet and identity details must remain inside its adapter. The
queue, playback service, media resolution, commands, and persistence cannot
import TS3 implementation types.
