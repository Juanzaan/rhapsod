# TS3 Music Bot Research

This document records reusable design ideas found in active TeamSpeak 3 music
bot projects. It is a reference for Rhapsod, not a code-copying plan.

## Projects reviewed

| Project                                                  | Language      | License | Useful observations                                                                                                                             |
| -------------------------------------------------------- | ------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| [TS3AudioBot](https://github.com/Splamy/TS3AudioBot)     | C#            | OSL-3.0 | Mature resource resolver, playlist lifecycle, loop modes, history, events, permissions, and diagnostics.                                        |
| [ts3-musicbot](https://github.com/Bettehem/ts3-musicbot) | Kotlin        | GPL-3.0 | Provider service abstraction for Spotify, YouTube, SoundCloud, Bandcamp, lyrics, and a separate player/queue layer.                             |
| [TS3-Music-Bot](https://github.com/xDroni/TS3-Music-Bot) | Node.js       | MIT     | Small command-driven Node architecture, queue editing, YouTube search, playlist handling, and cookie/header support.                            |
| [TS3MusicBot](https://github.com/HVCsano/TS3MusicBot)    | Kotlin/Docker | GPL-3.0 | Containerized deployment concept, but its image is tied to Arch/AUR and desktop players, so it is not a direct production template for Rhapsod. |

## Lessons for Rhapsod

### Short term

- Add a bounded queue and reject excessive playlist expansion.
- Keep current-track state, queue state, and playback process state separate.
- Add `previous`/history and shuffle only after deterministic queue tests exist.
- Add command permissions before exposing destructive commands such as `!stop`,
  `!clear`, or a future `!exit`.
- Keep provider extraction behind the existing resolver boundary. Spotify links
  should resolve metadata to a playable YouTube candidate; Spotify does not
  provide a raw audio URL for this use case.

### Audio and reliability

- Resolve metadata when accepting a request, but resolve the signed audio URL
  immediately before playback because provider URLs expire.
- Treat FFmpeg exit, broken pipes, and stalled input as playback errors and move
  to the next queued track with a bounded retry policy.
- Add prefetch only for metadata or validated short-lived resources; never reuse
  an old signed URL blindly.
- Preserve the TS3 identity and make process supervision part of deployment,
  not an interactive SSH session.

### Features deliberately deferred

- Spotify/SoundCloud/Bandcamp adapters require provider-specific policies and
  tests; they should not be added by copying GPL/OSL implementation code.
- A full plugin system, desktop-player integration, and a large command DSL add
  complexity before the TS3 audio path is operationally hardened.

## License boundary

Rhapsod is MIT-licensed. MIT-compatible ideas and code can be reused when their
copyright and license notices are preserved. GPL-3.0 and OSL-3.0 code should be
treated as reference only unless the project license strategy is intentionally
changed and reviewed. Reimplementing an observed behavior from public
documentation is preferred over copying implementation code.

Research snapshot: 2026-08-18.
