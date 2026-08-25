# Changelog

All notable changes to Rhapsod are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims
for [Semantic Versioning](https://semver.org/).

## [2.0.0] - 2026-08-24

Production release for the OCI profile (4 vCPUs, 3 GB RAM). This is a
major version bump: the bot now targets higher-capacity deployments while
preserving low-end fallbacks where practical.

### Added

- **Multi-source playback**: YouTube (video, Shorts, playlists), SoundCloud
  tracks and sets, Spotify tracks/albums/playlists (metadata only, playback
  via YouTube), Apple Music and Amazon Music links (resolved via SongLink),
  and direct HTTP(S) audio URLs / HLS streams.
- **Smart search ranking**: fuzzy term matching, channel-name credits,
  duration-based candidate selection, shortened-query retry, and penalty
  rules for altered audio (bass boosted, 8d, instrumental, mashup, etc.).
- **Playlist expansion**: YouTube, Spotify, and Apple Music / Amazon Music
  playlists expand up to 100 tracks per `!play` with duplicate detection
  and a friendly progress report.
- **Queue persistence**: the pending queue and current track survive bot
  restarts through `data/state.json`; tracks are restored only for users
  still connected to the TeamSpeak server, matched by UID.
- **Loop modes**: `!loop off|track|queue` repeats the current track or the
  whole queue; persists across restarts.
- **Seek and previous**: `!seek <seconds>` jumps within the current track;
  `!previous` replays the last finished track.
- **Direct audio URLs**: `!play <url>` accepts HTTP(S) audio files, HLS
  playlists, and extensionless streams; probed with ffprobe for metadata;
  private/loopback hosts are rejected (SSRF protection).
- **Audio pipeline upgrades**: Opus Music codec (correct TS3 wire format),
  EBU R128 loudness normalization (`RHAPSOD_LOUDNESS_TARGET_LUFS`, default
  -14 LUFS) with a -1.5 dBTP true-peak limiter, configurable Opus bitrate
  and complexity, and optional in-band FEC.
- **yt-dlp optimizations**: sequential fallback from `web_safari` to
  `web_embedded` player clients, reduced metadata timeout (3.5s baseline),
  single extractor retry, and `nice -n 10` priority on Linux.
- **Aggressive caching**: search results cached for 60 minutes (500
  entries), audio URLs persisted across restarts with 12-hour TTL, and
  a shared in-flight resolution for prefetch and playback.
- **Smart playlist prefetch**: depth 20 for playlists (>10 tracks), batch
  of 5 immediate + 5 deferred resolutions, parallel batch URL resolution
  (batch size 10), and max 4 concurrent yt-dlp jobs on the OCI profile.
- **Minimalist messages**: "Reproduciendo: {title}" on first play, "Ahora:
  {title}" on subsequent tracks; intermediate messages hidden by default
  (`RHAPSOD_VERBOSE=true` enables them).
- **OAuth 2.0 for youtubei.js**: automatic token refresh with structured
  logging; PO token provider (bgutil-ytdlp-pot-provider) as fallback.
- **Health checks**: YouTube authentication check on startup and every 24h,
  TeamSpeak liveness heartbeat (`RHAPSOD_TS3_HEARTBEAT_SECONDS`), and an
  event-loop watchdog that restarts the process on stalls.
- **Structured logging**: JSON logs to stdout and rotating files under
  `{RHAPSOD_DATA_DIR}/logs` with configurable retention; per-track playback
  session summaries joining metadata, timing, and audio metrics.
- **Audio health in `!stats`**: surfaces underruns, rebuffer events, and
  first-frame delay per track.
- **20+ commands with aliases**: `!play` (`!p`), `!playnext` (`!pn`),
  `!yt` (`!search`), `!queue` (`!q`), `!history` (`!hist`),
  `!now-playing` (`!np`), `!stats` (`!st`), `!volume` (`!vol`),
  `!move` (`!mv`), `!channel-move` (`!ch`), `!remove` (`!rm`),
  `!clear` (`!c`), `!shuffle`, `!loop`, `!lyrics` (`!ly`),
  `!test-tone` (`!tone`), `!help` (`!h`), and more.
- **Overload protection**: command concurrency gate
  (`RHAPSOD_MAX_CONCURRENT_COMMANDS`, default 3), queue cap (200 tracks),
  per-user limit (30 tracks), single-flight playlist expansion, and rate
  limiting on commands.
- **Search ranking improvements**: noise-word filtering, title-penalty
  rules for lyric videos and "official video", duration-proximity bonus,
  and channel-name credits.
- **FFmpeg low-latency flags**: `-fflags +nobuffer -flags +low_delay
-analyzeduration 0 -probesize 32` for reduced time-to-first-audio.
- **Persistent audio URL cache**: `{RHAPSOD_DATA_DIR}/audio-url-cache.json`
  (500 entries, pruned by expiry) so repeat plays start instantly.
- **YouTube client rotation**: rotating pool of 3 Innertube instances
  (IOS, ANDROID, WEB) with round-robin selection and correct player for
  stream decipher.
- **Custom libraries**: `src/lib/query-parser.ts` (music query parsing),
  `src/lib/timeout-config.ts` (timeout configuration),
  `src/lib/ranking-boosts.ts` (search ranking rules).
- **CI pipeline**: GitHub Actions runs format, lint, typecheck, tests, and
  build on every push and pull request.

### Changed

- Target OCI production profile with 4 vCPUs and 3 GB RAM.
- `!channel-move` restricted to configured admins.
- `RHAPSOD_MAX_CONCURRENT_YTDLP_JOBS=4` recommended for OCI profile.
- Queue prefetch depth raised from 3 to 10 (normal) / 20 (playlists).
- Search cache TTL raised from 15 minutes to 60 minutes.
- Audio URL timeout reduced from 45s to 30s for faster failure detection.
- Max concurrent yt-dlp jobs raised from 2 to 4 (with min 2 floor).
- Default volume remains 50%; Opus complexity raised to 10.

### Fixed

- Voice packets use codec 5 (Opus Music) as defined by the TS3 wire
  protocol; codec 6 was out of range.
- yt-dlp now requests the `web_embedded` YouTube player client, which is
  not blocked on datacenter IPs.
- Prefetch skips expired cached URLs so long-queued tracks are re-resolved
  during prefetch instead of stalling at play time.
- SoundCloud client-id discovery fetches asset scripts in parallel, cutting
  worst-case discovery time from ~144s to a single batch.
- Rate-limited commands now get a "wait a moment" reply instead of being
  silently dropped.
- The yt-dlp metadata output cap was raised from 2MB to 8MB so large video
  info JSONs can no longer fail track resolution.

## [1.2.0] - 2026-08-20

### Fixed

- Reconnects no longer strand the bot: a failed connect attempt now resets the
  client state before retrying (previously every retry threw
  "already connected" instantly and the bot gave up after ~20s), the heartbeat
  only declares the connection lost after two consecutive failed probes, and
  reconnect attempts back off exponentially (5s to 80s) instead of every 5s.
- After exhausting reconnect attempts the process now actually exits (was a
  zombie that kept the event loop alive with the heartbeat timer, defeating
  any supervisor restart policy) and stops the heartbeat first.
- A `!play http://...` or a full disk no longer silently kills the playback
  chain: `#createPlayback` failures are reported and the queue keeps playing,
  and the state file write is now best-effort and debounced.
- A running Spotify playlist/album expansion no longer restarts playback after
  `!stop` or `!clear`: the expansion detects the stop and aborts, both before
  and after each per-track search.
- Graceful restarts (SIGTERM/SIGINT) no longer wipe the persisted queue: the
  shutdown path stops without persisting the emptied queue, and pending state
  and audio-URL-cache writes are flushed before exit.
- Queue restore on startup now retries `listClients` a few times before giving
  up, so a single transient command failure no longer discards the whole
  persisted queue.
- `!remove` authorization is now UID-based: a third party can no longer remove
  someone else's tracks just by renaming to their nickname (nickname matching
  is only used as a fallback for legacy tracks without a stored UID).
- A rejected prefetched audio URL no longer poisons the shared `#prepared`
  entry for that source; the failed promise is cleaned up so the next attempt
  resolves fresh.
- Prefetch now skips expired cached URLs, so long-queued tracks are re-resolved
  during prefetch instead of stalling at play time.
- A transient 5s command timeout on the heartbeat probe no longer triggers a
  full disconnect/reconnect (requires two consecutive failures).
- Errors inside the audio frame callback (e.g. an oversized Opus VBR packet)
  are now routed through the player's failure path instead of crashing the
  process.
- `!test-tone` is rejected while music is playing instead of interleaving
  garbled frames over the active session.
- Direct audio URLs must now be `https:` (they could never play over `http:`
  anyway) and hosts pointing at private/loopback networks are rejected,
  removing an SSRF-ish probing primitive from `!play`.
- The client description is now fully escaped (control characters included),
  so a description with a newline no longer produces a malformed `clientset`.
- SoundCloud client-id discovery now fetches the asset scripts in parallel
  instead of sequentially, cutting the worst-case discovery time from ~144s to
  a single batch.
- Rate-limited commands now get a "wait a moment" reply instead of being
  silently dropped.
- The per-user rate-limiter map and the track-timing map in main are now
  bounded, so long-running bots stop growing memory on every distinct user or
  skipped track.
- The yt-dlp metadata output cap was raised from 2MB to 8MB so large video
  info JSONs can no longer fail track resolution with a buffer overflow.

### Removed

- Dead code cleanup: dropped the unused `RHAPSOD_LOG_DIR` config option, the
  never-called `YoutubeResolver.match`/`isAvailable`/`getAudioUrl(resource)`
  methods, and the unused `getAudioUrl(resource)`/`match` members of the
  service-side resolver interfaces.

### Fixed

- `RHAPSOD_MAX_CONCURRENT_COMMANDS` was documented and validated but never
  read; the bot now actually honors the configured value instead of always
  using 3.

### Added

- FFmpeg now limits the input probe (`-analyzeduration 1M -probesize 1M`),
  cutting the time-to-first-audio-frame roughly tenfold (measured 81ms vs
  1102ms on a YouTube stream) so playback starts sooner on every track.
- yt-dlp runs at reduced priority on Linux (`nice -n 10`): resolving a
  track's URL while another song is playing no longer competes for the CPU
  with ffmpeg and the Opus encoder, removing the stutter during lookups.
- The bot now prefetches the next three queued tracks instead of one, so
  rapid `!skip` chains land on already-resolved URLs instead of stalling
  playback while yt-dlp resolves each one.
- Search results are cached for 15 minutes: replaying the same song skips
  the yt-dlp search round-trip entirely (measured 3.5s per search).
- When the top-ranked candidate has no playable audio, the fallback
  candidates are now resolved in parallel instead of one after another,
  cutting the worst-case recovery time from several serial 4-6s lookups
  down to a single parallel batch.

- Search ranking prefers audio-length versions over the longer official video:
  noise words in the query (o, and, de, la, official, audio, lyrics, ...) no
  longer count as title terms (the letter "o" previously matched almost any
  title and pushed unrelated results to the top), "official video" titles stop
  getting an automatic bonus, and when the track length is unknown the ranking
  rewards candidates whose duration sits near the median of the results so a
  song's audio/lyric version (e.g. 236s) beats the music video with a silent
  intro/outro (e.g. 298s).

- YouTube authentication health check: on startup and every 24h the bot
  resolves a known video's stream URL; if it fails, a clear log line reports
  that the cookies are probably expired and must be re-exported. Playback
  errors caused by YouTube demanding sign-in now tell users the cookies may be
  expired instead of dumping the raw extractor message.

- TeamSpeak liveness heartbeat: the bot asks the server for its client list
  every `RHAPSOD_TS3_HEARTBEAT_SECONDS` (default 60, `0` disables). A silent
  session loss — e.g. the server restarting while the UDP socket stays open —
  is now detected within a minute and the existing reconnect loop kicks in,
  instead of leaving the bot hanging "connected" forever.

- Persisted audio URL cache (`{RHAPSOD_DATA_DIR}/audio-url-cache.json`, 500
  entries, pruned by expiry): once a track's stream URL has been resolved it is
  reused across bot restarts until it expires, so repeat plays start instantly
  without another yt-dlp round trip.
- yt-dlp runs with a single extractor retry (`--extractor-retries 1`) instead
  of the default three, so a YouTube-side throttling hiccup costs ~6s instead
  of ~15s.

- Persistent structured logs: every line is written as JSON both to stdout
  (captured by systemd) and to a rotating file under `{RHAPSOD_DATA_DIR}/logs`
  (`RHAPSOD_LOG_DIR` overrides the directory, `RHAPSOD_LOG_RETENTION_DAYS`
  controls how many days of files are kept, default 14). Each played track
  produces a single `Playback session` summary line joining metadata, audio
  URL resolution (with cache hit), first frame delay and end-of-track buffer
  metrics, so latency problems are diagnosed from one log line.

- `!seek <segundos>` jumps the current track to a new position (FFmpeg restarts
  the source with a `-ss` offset; the queue position is preserved) and
  `!previous` / `!prev` replays the last finished track. See
  [issue #19](https://github.com/Juanzaan/rhapsod/issues/19).
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
- The queue restore matches requesters by their TeamSpeak unique ID
  (`client_uid`) instead of their display name, so tracks survive a restart
  even when a user is reconnecting with a different nickname. The requester
  UID is stored alongside each queued track.
- Audio URL lookups for playback no longer wait for an in-flight playlist
  expansion: yt-dlp jobs for the currently playing track run in parallel with
  metadata jobs (up to two concurrent yt-dlp processes). A track starts as soon
  as its URL is resolved instead of stalling ~5-10 s behind every queued
  search, which made the start of a playlist sound laggy.
- The next track's audio URL is prefetched only after the current track has
  sent its first frame (instead of at session start), so the ffmpeg startup of
  a new track does not fight the yt-dlp process for the CPU on single-core
  machines. Track URLs are also resolved at most once: a prefetch and the
  playback chain share the same in-flight resolution, and the queue head is
  prefetched as soon as it is enqueued.
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
