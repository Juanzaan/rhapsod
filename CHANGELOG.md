# Changelog

All notable changes to Rhapsod are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims
for [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Direct audio URLs and radio streams: `!play <url>` (and plain pasting) now
  accepts http(s) audio files (`.mp3`, `.ogg`, `.m4a`, `.aac`, `.opus`,
  `.flac`, `.wav`), HLS playlists (`.m3u8`) and extensionless streams whose
  `Content-Type` is audio (probed with a HEAD request). Tracks are probed with
  `ffprobe` (title/artist tags or the filename; infinite streams are named
  `Radio: <host>`), played straight through FFmpeg — no yt-dlp round trip.
  See [issue #20](https://github.com/Juanzaan/rhapsod/issues/20).
- FFmpeg sends a configurable User-Agent when opening audio URLs
  (`RHAPSOD_FFMPEG_USER_AGENT`); some streams and CDNs reject the default
  `Lavf/…` agent. See [issue #23](https://github.com/Juanzaan/rhapsod/issues/23).
- The queue survives a bot restart, but only for users who are still connected
  to the TeamSpeak server at startup: pending tracks whose requester is offline
  are dropped. The persisted state (`state.json`) now includes the queue
  (current track first), so `!colar`, `!mover`, `!quitar`, `!shuffle` and
  playback position changes are saved continuously.
- Spotify playlist support after Spotify's February 2026 API migration, which
  dropped anonymous playlist reads (`/playlists/{id}/tracks` now returns 403,
  `/items` requires extended quota mode that only organizations can request).
  Playlist expansion now falls back to the public `open.spotify.com/embed`
  page (title/artists/duration per track, no auth needed). The optional
  `RHAPSOD_SPOTIFY_REFRESH_TOKEN` (obtained with `node scripts/spotify-auth.mjs`)
  switches playlist reads to the Web API `/items` endpoint when available.
- yt-dlp now requests the `web_embedded` YouTube player client, which is not
  blocked on datacenter IPs ("The page needs to be reloaded" / bot-check
  errors).
- Overload protection:
  - Commands are processed with a concurrency gate
    (`RHAPSOD_MAX_CONCURRENT_COMMANDS`, default 3): extra commands get a
    rate-limited "busy" reply instead of piling up yt-dlp jobs.
  - The queue is capped (`RHAPSOD_MAX_QUEUE_TRACKS`, default 200) and each user
    can only hold up to `RHAPSOD_MAX_TRACKS_PER_USER` (default 30) pending
    tracks.
  - Only one playlist/album expansion runs at a time; concurrent expansions get
    a "wait" error and playlist imports stop early once a cap is hit.

### Fixed

- Voice packets use codec 5 (Opus Music) as defined by the TS3 wire protocol;
  codec 6 was out of range. (Introduced in v1.1.0.)

## [1.1.0] - 2026-08-19

### Added

- Audio quality and stability pass:
  - Opus in-band FEC is now off by default (`RHAPSOD_OPUS_PACKET_LOSS_PERCENT`
    defaults to `0`). The old default of 10% made the encoder permanently
    reserve bitrate for packet loss, producing the muffled "underwater" sound.
  - The frame scheduler no longer bursts catch-up frames after an event-loop
    stall: it drops the missed frames and keeps a steady 20 ms cadence, so the
    server never receives a jitter spike.
  - Voice packets are declared as Opus Music (codec 6) instead of Opus Voice
    (codec 5), matching how the stream is encoded.
  - Global `unhandledRejection`/`uncaughtException` handlers keep the bot
    running on transient failures and restart it via systemd on hard crashes.
  - Playback pauses while the bot reconnects to TeamSpeak and resumes right
    after, so no audio is sent into a dead socket.
  - Graceful shutdown now bounds the disconnect wait to 5 seconds.

### Added

- GitHub Actions CI: every push and pull request runs the full check pipeline
  (format, lint, typecheck, tests, build).
- Watchdog (`RHAPSOD_WATCHDOG_INTERVAL_MINUTES`, default 15, `0` disables):
  if the event loop stalls past twice the interval, the process exits with
  code 1 so systemd restarts it.
- TeamSpeak reconnect protection: after a kick or runtime disconnect, the bot
  retries at most five times with a five-second delay, then shuts down instead
  of reconnecting forever.

### Changed

- `!volume`, `!stop`, `!clear`, `!shuffle` and `!loop` are no longer
  admin-only: every command is open to everyone, and `RHAPSOD_ADMIN_UIDS`
  only covers removing other users' tracks.
- The default output volume is now 50% (previously 100%).

### Added

- State persistence: `!volume` and `!loop` survive restarts through
  `data/state.json` (atomic writes, corrupt files ignored).
- `RHAPSOD_ADMIN_UIDS` (comma-separated TeamSpeak uids): allows admins to
  remove tracks requested by other users with `!remove`.
- `!stats` (`!st`): uptime, tracks played since start, current track, queue
  length and current volume/loop mode.
- SoundCloud sets (`/sets/` links) now expand through SongLink, playing the
  equivalent YouTube playlist when available.
- `!yt <n> <query>` queues the n-th ranked search result instead of the first
  one.
- Queue ergonomics: `!playnext` (`!pn`/`!next`) promotes a single track,
  `!move` (`!mv`) reorders pending tracks, `!remove` accepts inclusive ranges,
  `!queue [page]` displays 10 tracks per page, and `!history` (`!hist`) shows
  recently started tracks.
- Spotify playlists and albums in `!play`: paged expansion through the Web API
  (up to 20 tracks, 429 backoff, duplicates skipped) with the same
  artist/title search and expected-duration ranking as tracks.
- `!shuffle`: randomize the pending queue (the current track keeps playing).
- Versions titled `clean`/`edited` are penalized in YouTube search unless the
  query explicitly asks for one (same rule as live/remix).
- Altered-audio versions (`bass boosted`, `8d`, `instrumental`, `mashup`,
  `reverb`, `extended`, ...) are penalized unless the query asks for them,
  keeping album/playlist playback close to the original masters.
- Failed commands are now logged (`Command failed`) and transient network
  errors (`fetch failed`) get a friendly retry message.
- Lyric videos are lightly penalized so official masters win when available,
  but still play when nothing else matches (same skip rule when asked).
- Audio pipeline: EBU R128 loudness normalization
  (`RHAPSOD_LOUDNESS_TARGET_LUFS`, default -14 LUFS, `0` disables) so every
  track plays at a consistent level with a -1.5 dBTP true-peak limiter; the
  default Opus bitrate is now 96 kbit/s to keep VBR packets inside the
  TeamSpeak 497-byte ceiling (no truncated frames on loud passages).
- `!volume` now maps 0-100 to a perceptual gain curve (-40 dB to 0 dB),
  matching how real volume controls behave.
- Opus encoder: complexity raised to 10 (best quality; measured +0.06 ms/frame
  on the 1-vCPU VM) and in-band FEC enabled at 10% expected packet loss
  (`RHAPSOD_OPUS_COMPLEXITY`, `RHAPSOD_OPUS_PACKET_LOSS_PERCENT`, `0` disables
  FEC) so lost voice packets are recovered instead of dropping audio.
- Apple Music and Amazon Music links in `!play`: resolved through SongLink to
  the YouTube equivalent (single tracks and playlists) with SoundCloud as
  fallback, since neither service exposes a public audio API.
- `!lyrics` (`!ly`): plain lyrics for the current track through LRCLIB (free
  public API, no account), parsed from the track title; truncated to 1600
  characters to fit a TeamSpeak message.
- `!queue`/`!now-playing` show per-track durations when known.

### Fixed

- Frame delivery no longer drops audio when the event loop stalls (e.g. while
  yt-dlp resolves metadata after `!play`): missed frames are now sent as a
  short catch-up burst (capped at 25 frames) instead of being skipped, so the
  current track stops lagging while a new one is being queued.
- Rapid `!skip` bursts no longer wedge the bot: playback runs as a single
  serialized chain, so consecutive skips coalesce into one audio resolution
  instead of piling up wasted yt-dlp jobs that froze the queue for minutes
  on long, uncached queues (search/playlist tracks).
- yt-dlp jobs beyond 8 pending are rejected with a friendly Spanish message
  instead of queuing forever ("El bot está saturado..."), and observer
  callbacks (`onPlaybackStarted`) can no longer crash the playback chain.
- `!volume <0-100>`: PCM gain applied to frames before Opus encoding, affecting
  every listener; changes apply live to the current track.
- `!loop [off|track|queue]`: repeat the current track (`track`) or the whole
  queue (`queue`); `!stop`/`!clear` disable looping.
- `RHAPSOD_METRICS_INTERVAL_MINUTES`: periodic RSS/heap logging (default 15
  minutes, `0` disables) for the 897MB-VM memory monitoring.
- `RHAPSOD_TS3_CLIENT_DESCRIPTION` sets the bot's TeamSpeak client description
  (any client can set its own description; no server permissions needed).
- `test:coverage` script.

## [1.0.0] - 2026-08-19

### Added

- Spotify track links in `!play`: metadata via the Spotify Web API (client
  credentials flow, no user login) and the matching "artist title" searched on
  YouTube for playback. Requires `RHAPSOD_SPOTIFY_CLIENT_ID` /
  `RHAPSOD_SPOTIFY_CLIENT_SECRET`.
- `!play` accepts free text and runs the YouTube search (same behavior as
  `!yt`). Unsupported providers (local files, generic URLs, Spotify
  playlists/albums) fail with clear messages.
- Resolver contract defined by the application service
  (`YoutubePlaybackResolver`) with `name`/`match` on each media provider.

### Fixed

- ffmpeg zombies after `!skip`: `SIGKILL` after 3s when `SIGTERM` is ignored
  by an HLS download stuck in a futex wait (`998fe2d`).
- Audio drift on buffer underruns: continuous silence frames instead of gaps
  in the frame flow, lower prebuffer, immediate recovery, opus complexity 10→5
  (`59a7778`).
- Search ranking rejected valid results: no penalty for version terms present
  in the query, fuzzy term matching (Levenshtein ≤ 1), channel-name credits,
  and a shortened-query retry (`4b1101a`, `67bc1d5`).
- Spotify credentials on the production unit file: `SPOTIFY_*` renamed to
  `RHAPSOD_SPOTIFY_*` so the config schema picks them up.

### Changed

- Chat messages no longer announce "fuente alternativa".
- Deployment documented for systemd with the production unit file
  (`docs/deployment.md`), including `MemoryMax`/`MemorySwapMax` limits.
- Removed dead `src/ports` contracts and superseded abstractions; the TS3
  adapter now exposes the only connection contract the application needs.
