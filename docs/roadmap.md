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

### Queue persistence

Save the pending queue and current track to `data/state.json` so a restart
continues the session instead of dropping everything. See
[issue #15](https://github.com/Juanzaan/rhapsod/issues/15).

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
