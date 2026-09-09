# Roadmap

Progress is tracked in [GitHub issues](https://github.com/Juanzaan/rhapsod/issues);
this document summarizes the phases.

## Release lines

### 1.x — low-end stable (frozen)

The `v1.0.0` through `v1.2.1` releases are optimized for VPS deployments with
1 vCPU and 1 GB RAM. `v1.2.1` is the final release in this line; new work
happens on 2.x.

### 2.x — active line

Production runs on OCI (4 vCPUs, 3 GB RAM) and is deployed from `main` on
every release. The current release is **v2.4.1** (see
[CHANGELOG.md](../CHANGELOG.md)). History: v2.0.0 rebuilt the playback stack
for the OCI profile, v2.1.0–v2.2.0 added gapless playback and hardening,
v2.3.0 shipped the owner-facing surface (web panel, one-command installer,
YouTube 403 resilience), v2.3.1 fixed the dashboard hang and hardened the
panel, and v2.4.0 made handoffs actually gapless with an observable driver.

## Released highlights

### v2.4.0 (2026-09-08) — gapless playback, observable driver

The prewarm machinery that had never fired in production now drives track
handoffs (~0.7–2 s gaps → ~20–50 ms), two-pass loudness normalization reaches
ffmpeg, and a 90 s watchdog guarantees a wedged resolution can no longer
silence the bot. The panel reports `buffering` while resolving instead of a
misleading `idle`. Underneath: the prepared-URL layer extracted from the
playback service, an explicit `PlaybackEpoch` staleness protocol, Opus 128
kbps default, parallel music-aware search, SoundCloud/direct-URL cache
persistence, and an installer that survives a fresh VPS end to end (panel-only
setup mode with a guided wizard).

### v2.3.1 (2026-09-07) — panel hang fix

The dashboard no longer hangs behind a wrong `content-length` (gzip path
removed); `/api/env` writes restricted to known settings; the version string
comes from `package.json`; HEAD-rejecting hosts get a ranged-GET fallback;
security headers on every panel response.

### v2.3.0 (2026-09-03) — owner-facing surface

Setup panel (Hono console on localhost, basic auth, SSH-tunnel access), ON AIR
dashboard, server tree with click-to-move, bidirectional channel chat,
one-command installer, WARP proxy fallback for YouTube 403s, bgutil POT
provider, and hardening against datacenter-IP blocking. Released with
release-please automation (repaired in this cycle: tag discovery and PR
creation had been silently broken since v2.0.0).

### v1.2.1 (2026-08-20) — stable low-end release

The latest 1.x release: fixed playback option propagation into FFmpeg, limited
`!channel-move` to configured admins, and removed temporary server diagnostics.

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

## Active work

### TeamSpeak 6 (Phase 4)

Implement a TS6 voice adapter behind the same connection contract the TS3
adapter exposes and run the shared behavior suite against both protocols.
Prerequisite advanced: the TS3 connection contract is pinned behind a mocked
client (#40), and the playback staleness protocol is an explicit tested
value object (#51). See
[issue #12](https://github.com/Juanzaan/rhapsod/issues/12).

### User preferences (Phase 2.7)

Optional per-TS3-user signals (favorites, protected queue, preferred source).
Preferences must never override a poor title/artist match. See
[issue #13](https://github.com/Juanzaan/rhapsod/issues/13).

### Welcome/join announcements

Greet users entering the bot's channel, with an optional short audio clip.
See [issue #21](https://github.com/Juanzaan/rhapsod/issues/21).

### Internal debt

- Split `src/application/youtube-playback-service.ts` (~2k lines) into
  resolver / prefetch / playback controller / persistence. Cut 1 done: the
  prepared-URL store is its own tested module (#49).
- Extract `src/main.ts` wiring (~860 lines, low coverage) into tested
  init modules. First piece done: one shared yt-dlp resolver factory for
  both boot paths (#50).

## Shipped checks from other bots

Reviewing open issues in TS3AudioBot and ts3-musicbot, mapped to Rhapsod:

- YouTube blocking datacenter IPs (TS3AudioBot #1059/#1061): mitigated with
  the bgutil POT provider and WARP proxy fallback (v2.3.0); an opt-in yt-dlp
  OAuth flow remains future work. See
  [issue #22](https://github.com/Juanzaan/rhapsod/issues/22).
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

## Shipped research-driven features

Findings from surveying existing TS3 music bots (TS3AudioBot, ts3-musicbot,
OpenTSMusicBot, xDroni/TS3-Music-Bot):

- **Named playlists**: `!playlist save|import|list|play <name> [url]` to persist
  and replay saved sets. Shipped. See
  [issue #18](https://github.com/Juanzaan/rhapsod/issues/18).
- **Seek and `!previous`**: `!seek <seconds>` within the current track and
  `!previous` to replay the last one. Shipped. See
  [issue #19](https://github.com/Juanzaan/rhapsod/issues/19).
- **Radio streams and direct audio URLs**: FFmpeg consumes http(s) streams
  (icecast, m3u8) directly; `!play <audio-url>` accepts direct files, HLS and
  audio streams. Shipped. See
  [issue #20](https://github.com/Juanzaan/rhapsod/issues/20).
- **Queue persistence**: the pending queue and current track persist to
  `data/state.json` continuously and are restored at restart for users still
  connected. Shipped. See
  [issue #15](https://github.com/Juanzaan/rhapsod/issues/15).
- **Audio health in `!stats`**: per-track playback metrics (underruns,
  rebuffer events, first-frame delay) visible in `!stats`, not just logs.
  Shipped. See [issue #16](https://github.com/Juanzaan/rhapsod/issues/16).
- **Native SoundCloud sets**: `/sets/` links expand through the SoundCloud API
  when SongLink only finds the YouTube equivalent. Shipped. See
  [issue #17](https://github.com/Juanzaan/rhapsod/issues/17).

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
