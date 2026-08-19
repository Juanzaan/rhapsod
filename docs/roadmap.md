# Roadmap

Progress is tracked in [GitHub issues](https://github.com/Juanzaan/rhapsod/issues);
this document summarizes the phases.

## Released

### v1.1.0 (2026-08-19)

Quality and stability pass over v1.0.0: the Opus FEC default was removed (it
degraded quality on healthy links), the frame scheduler no longer bursts
missed frames, voice packets are declared as Opus Music, global crash handlers
were added, playback pauses while reconnecting, and CI + a watchdog make the
deployment self-healing.

### v1.0.0 (2026-08-19) — stable

Multi-source playback validated in production: YouTube (video, Shorts,
playlists), SoundCloud tracks, Spotify tracks, and free-text search with fuzzy
ranking. systemd deployment documented, memory limits applied, and production
logs clean (0 underruns / 0 zombies over multi-hour sessions).

## v2.0 (next)

### Known-bug checks from other bots

Reviewing open issues in TS3AudioBot and ts3-musicbot, mapped to Rhapsod:

- YouTube blocking datacenter IPs (TS3AudioBot #1059/#1061): add an opt-in
  yt-dlp OAuth flow for the VPS. See [issue #22](https://github.com/Juanzaan/rhapsod/issues/22).
- Custom User-Agent for FFmpeg stream input (TS3AudioBot #1066): some HTTP
  streams reject the default UA. Shipped as `RHAPSOD_FFMPEG_USER_AGENT`.
  See [issue #23](https://github.com/Juanzaan/rhapsod/issues/23).
- Audio cutting out shortly after start (#1039) and laggy audio (#1027): our
  underrun recovery, URL expiry cache and the v1.1.0 scheduler/FEC fixes cover
  the known causes; audio health telemetry is tracked in
  [issue #16](https://github.com/Juanzaan/rhapsod/issues/16).
- Antiflood (TS3AudioBot #1001): shipped in the overload-protection pass
  (command gate, queue caps, single-flight expansions).
- Stuck states after errors (#992, #1030): covered by the serialized playback
  chain, watchdog and global crash handlers.

### Research-driven features

Findings from surveying existing TS3 music bots (TS3AudioBot, ts3-musicbot,
OpenTSMusicBot, xDroni/TS3-Music-Bot):

- **Named playlists**: `!playlist save|import|list|play <name> [url]` to persist
  and replay saved sets. See [issue #18](https://github.com/Juanzaan/rhapsod/issues/18).
- **Seek and `!previous`**: `!seek <seconds>` within the current track and
  `!previous` to replay the last one. See [issue #19](https://github.com/Juanzaan/rhapsod/issues/19).
- **Radio streams and direct audio URLs**: let FFmpeg consume http(s) streams
  (icecast, m3u8) instead of resolving everything through yt-dlp. Shipped:
  `!play <audio-url>` accepts direct files, HLS and audio streams. See
  [issue #20](https://github.com/Juanzaan/rhapsod/issues/20).
- **Welcome/join announcements**: greet users entering the bot's channel, with
  an optional short audio clip. See [issue #21](https://github.com/Juanzaan/rhapsod/issues/21).

### Queue persistence

Save the pending queue and current track to `data/state.json` so a restart
continues the session instead of dropping everything. Shipped: the queue is
persisted continuously and restored at startup for users still connected to
the server. See [issue #15](https://github.com/Juanzaan/rhapsod/issues/15).

### Audio health in `!stats`

Surface per-track playback metrics (underruns, rebuffer events, first-frame
delay) in `!stats` so quality regressions are visible to users, not just the
logs. See
[issue #16](https://github.com/Juanzaan/rhapsod/issues/16).

### Native SoundCloud sets

Expand `/sets/` links through the SoundCloud API when SongLink only finds the
YouTube equivalent, instead of failing on missing matches. See
[issue #17](https://github.com/Juanzaan/rhapsod/issues/17).

### User preferences (Phase 2.7)

Optional per-TS3-user signals (favorites, protected queue, preferred source).
Preferences must never override a poor title/artist match. See
[issue #13](https://github.com/Juanzaan/rhapsod/issues/13).

### TeamSpeak 6 (Phase 4)

Implement a TS6 voice adapter behind the same connection contract the TS3
adapter exposes and run the shared behavior suite against both protocols. See
[issue #12](https://github.com/Juanzaan/rhapsod/issues/12).

## Operations (Phase 3)

Done: periodic RSS/heap logging (`RHAPSOD_METRICS_INTERVAL_MINUTES`, see
[issue #8](https://github.com/Juanzaan/rhapsod/issues/8)), SSH restricted to
the Tailscale tailnet (`100.64.0.0/10` NSG rule, JIT disabled; see
[issue #9](https://github.com/Juanzaan/rhapsod/issues/9)), GitHub Actions CI,
and an event-loop watchdog that exits the process when it stalls.

## Design principles

- DRM-protected or blocked content is reported, never bypassed.
- Credentials and cookies never enter Git; secrets live in the deployment
  secret store.
- Personalization is a small ranking adjustment after objective matching,
  never an override.
- Playback always happens through YouTube/SoundCloud; Spotify is metadata only.
