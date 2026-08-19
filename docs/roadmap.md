# Roadmap

Progress is tracked in [GitHub issues](https://github.com/Juanzaan/rhapsod/issues);
this document summarizes the phases.

## Released

### v1.0.0 (2026-08-19) — stable

Multi-source playback on the HolyPVP TeamSpeak server: YouTube (video, Shorts,
playlists), SoundCloud tracks, Spotify tracks, and free-text search with fuzzy
ranking. systemd deployment documented, memory limits applied, and production
logs clean (0 underruns / 0 zombies over multi-hour sessions).

## Post-v1

### Spotify playlists and albums

`!play` already resolves Spotify _tracks_ (metadata via Web API, playback via
YouTube). Extend it to albums and playlists with bounded expansion and 429
backoff. See [issue #10](https://github.com/Juanzaan/rhapsod/issues/10).

### Commands reserved for post-v1

`!volume` (PCM gain before the Opus encoder) and `!loop [off|track|queue]`.
See [issue #11](https://github.com/Juanzaan/rhapsod/issues/11).

### User preferences (Phase 2.7)

Optional per-TS3-user signals (favorites, protected queue, preferred source).
Preferences must never override a poor title/artist match. See
[issue #13](https://github.com/Juanzaan/rhapsod/issues/13).

### Operations (Phase 3)

Memory monitoring on the 897MB VM and proactive log review are partially in
place (`MemoryMax=512M`, `MemorySwapMax=1G`). See
[issue #8](https://github.com/Juanzaan/rhapsod/issues/8) and
[issue #9](https://github.com/Juanzaan/rhapsod/issues/9) (SSH/NSG hardening).

### TeamSpeak 6 (Phase 4)

Implement a TS6 voice adapter behind the existing `VoiceClient` port and run
the shared behavior suite against both protocols. See
[issue #12](https://github.com/Juanzaan/rhapsod/issues/12).

## Design principles

- DRM-protected or blocked content is reported, never bypassed.
- Credentials and cookies never enter Git; secrets live in the deployment
  secret store.
- Personalization is a small ranking adjustment after objective matching,
  never an override.
- Playback always happens through YouTube/SoundCloud; Spotify is metadata only.
