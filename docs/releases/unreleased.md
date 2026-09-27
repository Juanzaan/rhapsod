[Español](unreleased.es.md)

## Summary

Measured loudness normalization works for the first time: tracks with a loudness profile play at the target level without the gain riding of single-pass normalization. Optional skipping of the non-music intro and outro of YouTube music videos.

## Changes

- The loudness profiler never produced a profile: ffmpeg ran with `-loglevel error`, which hides the loudnorm report, the report was read from stdout instead of stderr, and its values, printed as strings, were rejected. Every finite track played through dynamic single-pass `loudnorm`, and each prewarm repeated the 120-second measurement. Measured tracks now get two-pass normalization, linear when the gain fits under the -1.5 dBTP ceiling.
- Log and count yt-dlp daemon failures instead of falling back silently: the bot warns at most once a minute, the daemon writes failures to its journal, and `/api/metrics` exports `rhapsod_ytdlp_daemon_up` and `rhapsod_ytdlp_daemon_fallbacks_total`.
- Make `/api/health` answer 503 while reconnecting to TeamSpeak (it reported connected from a cached channel id) and add the YouTube login and daemon state to its body.
- Flush the log file before exiting, so the last line before a crash or restart reaches `data/logs`.
- The next track's loudness is measured from the moment the current track starts instead of when its warm stream is built at the midpoint, so first plays use their measured profile. Nothing is measured while the queue is idle, to keep a second download away from a cold start.
- The loudness profile covers the whole track instead of its first 120 seconds, so linear gain sized for a quiet intro cannot clip a louder chorus. Tracks longer than 15 minutes are not measured and keep the dynamic filter.
- A song already in the queue is now skipped by its error type, not by the wording of its Spanish chat message. Before, rewording "Esa canción ya está en la cola." would make a playlist, Spotify or Apple Music collection with a queued song fail as a whole. SoundCloud DRM errors are recognized the same way; yt-dlp DRM output is still matched by its text, since yt-dlp reports it only there.
- A song whose ffmpeg process dies after playback started (an outage longer than ffmpeg's own reconnects, a 5xx on reconnect) now resumes once from its position with a freshly resolved URL, the same way a stalled stream does. It used to end as an error and skip to the next track.
- Panel: every page uses the same 1320px frame, so the nav no longer shifts between pages. Cards in a console row share their height and the queue scrolls inside its card; Settings and Commands show each group full width with an even grid of fields and commands.
- Panel: the Server page no longer rebuilds the channel tree every 2.5 seconds when nothing changed, which cut hover transitions mid-way. With the system set to reduce motion, only the background and the turntable stop; click and hover feedback stay.
- Panel: player states read in Spanish (SONANDO, EN PAUSA, CARGANDO, EN ESPERA), and the setup wizard points new installs to `!claim` for the first admin, with the admin UID field moved to an advanced section.
- Add `RHAPSOD_SKIP_NON_MUSIC` (default `false`): YouTube music videos start where the music starts and end where it ends, using the non-music segments (spoken intros, scenes, credits) that SponsorBlock users mark with the `music_offtopic` category. Only an intro and an outro are cut, never a segment in the middle, and a cut that would keep less than half the track or less than 30 seconds is ignored. The lookup sends a 4-character prefix of the SHA-256 of the video id, waits at most 1.5 seconds and runs in parallel with the audio URL; when it fails the track plays whole.

## Upgrade

No action is required beyond the v4.0.0 upgrade steps. `RHAPSOD_LOUDNESS_TARGET_LUFS` keeps its meaning and default (-14). `RHAPSOD_SKIP_NON_MUSIC` is off unless set to `true`.

## Verification

Run `npm run check` and `npm run test:coverage`. On a host with ffmpeg, `npx vitest run tests/loudness-profiler.test.ts` also measures a generated tone with the real binary.
