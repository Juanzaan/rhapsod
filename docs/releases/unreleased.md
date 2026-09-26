[Español](unreleased.es.md)

## Summary

Persistence fixes, dependency updates, deployment repairs and consistent bilingual release documentation.

## Changes

- Extend the listening-room design to Settings, Commands, Setup and Server; add channel search, empty-channel counts and expand/collapse controls. Fix raw channel-name parsing, missing-parent rendering and settings read-only rendering.
- Show every visible channel, including empty ones: the server tree is now discovered by probing `channelinfo` per channel id in the background (voice clients cannot run `channellist`), refreshed at startup, on reconnect and every ten minutes.
- Redesign the dashboard as a responsive listening console with animated local backgrounds, saved motion preferences, radio and autoplay controls, and keyboard seeking.
- Preserve unread favorites and listening history during shutdown; reject invalid favorite positions.
- Bound listening-track memory and expire the autoplay session boost after inactivity.
- Update compatible runtime and development dependencies, including libopus-wasm, Hono, Zod and Vitest.
- Refresh panel styling and prevent stale dashboard/settings responses, with settings-load retry.
- Repair Docker Python installation and daemon startup; preserve installer configuration and cookies on reruns.
- Standardize historical and future release notes with English and Spanish summaries, upgrade guidance and verification steps.
- Keep autoplay playing after a restart: recent listening history seeds the mix rotation and restores the last listener's taste instead of starting silent.
- Play radio streams that refuse HEAD probes: Icecast and Shoutcast stations answering 400 are confirmed with a one-byte ranged GET, with added Shoutcast AAC content types.
- Play pasted TuneIn links (tun.in short links and tunein.com pages) in !play and !radio, resolving them to the station stream.
- Probe direct streams on ffprobe builds without -max_redirects support (static 7.0.x): the redirect block is passed only when the binary accepts it.
- Resolve Apple Music song, album and playlist links through the keyless iTunes lookup after SongLink retired anonymous access; playlists expand to lazy YouTube searches like Spotify collections. Amazon Music stays on SongLink.
- Use the same animated background, scene picker and motion control on every panel page, not only the dashboard.
- Remove the audio filters (`!bassboost`, `!nightcore`, `!vaporwave`, `!8d`, `!filter`, `!effects`) and their panel controls. They were rarely used and restarted the stream on every change; a filter saved in `data/state.json` by an older version is ignored on load.
- Rework autoplay as a DJ that rotates similar tracks, channel classics (requested and finished before, rested six hours) and discoveries from the channel's favorite artists. Autoplay's own picks no longer count as requests in `!tops` or the taste profile; existing listening history is corrected once on load. Skipped picks rest their source for two turns, and fetched mixes are reused for 30 minutes.
- Stop ffmpeg and ffprobe from fetching plain-HTTP URLs listed inside HLS playlists (for example the cloud metadata address or the local yt-dlp daemon) by restricting every nested open to TLS, and stop logging raw stream URLs and ffmpeg stderr on every track end.
- Bring the dashboard to life: per-track colors across the player, controls and background, a tonearm that lowers onto the record, decorative equalizer bars, a smoothly advancing progress bar, staggered card entrances, animated counters, button ripples and cursor-following card highlights. The motion previously wired to an animation library that was never loaded now runs locally and respects the motion toggle and reduced-motion settings. Settings, Commands, Server and Setup share the same life: meaning-first setting labels with unsaved-change tracking, click-to-copy commands with highlighted matches, animated server counts, a spinning setup record with sliding wizard steps, page crossfades and scroll-in cards. The dashboard adds a seek-time tooltip, a live volume fill, animated queue removals and a gray offline state. The panel also serves its own favicon.
- Show spacer section labels as plain headers that can never be joined or moved, and order siblings by channel_order chains like the TeamSpeak client.
- Reject panel writes that are not same-origin JSON, so a web page opened while the SSH tunnel is up can no longer run commands or restart the bot with the browser's cached credentials. Panel pages no longer embed the password.
- Validate panel settings with the startup rules before saving, reject values with line breaks, keep comments and permissions in the env file, and make the yt-dlp, FFmpeg and ffprobe paths read-only from the web.
- Refuse to start the panel with a published default password (`rhapsod`, `change-me`, `admin`, `password`).
- Flush favorites, history, telemetry and the queue before every exit: panel restart, watchdog, crash handlers and reconnect failure. Shutdown waits at most 5 seconds instead of at least 5. Crash logs keep the error message.
- Treat the panel as an administrator, so skipping or removing another user's track works from the web.
- The weekly yt-dlp update no longer restarts the bot: the service now uses `Wants=` on the daemon instead of `Requires=`, and the update retries pip with `--break-system-packages` on Debian 12 and Ubuntu 24.04.
- Redact bearer tokens and full cookie headers in logs and diagnostics.
- Treat `!seek`, filter changes and 403 retries as the same play: no second "Reproduciendo" message, no extra count in stats, no skipped listen in the taste profile, and `!previous` returns the prior track. The panel position continues from the seek target instead of restarting at 0:00.
- Resume 403 retries where the audio stopped instead of replaying the start of the track, retry silently instead of posting an error for each attempt, and rejoin live radio at the live edge. 403 detection matches the HTTP error wording instead of any "403" in URLs.
- Use the configured FFmpeg binary and User-Agent for prewarmed next-track streams; they used to fall back to the bundled ffmpeg-static.
- Space outgoing chat messages one second apart even when several are queued at once, log messages dropped by the anti-flood queue, split texts longer than 1024 characters (such as `!help` or `!debug-server` on large servers) instead of losing them, and detect a heartbeat probe that never answers.
- `!stop` and `!clear` follow the same ownership rule as `!skip` and `!remove`: they are refused when the queue holds another user's tracks, unless the sender is an admin. Autoplay picks and tracks whose requester left the server are communal, so an absent user's tracks never pin the queue.
- Fix the setup wizard, which could not finish an install: "Probar y siguiente" tested the TeamSpeak connection but never moved on, each step blanked the values of the steps before it (the review showed "Servidor TS3 (no seteado)"), and saving sent internal YouTube check fields that the settings endpoint rejected with "Clave desconocida". The wizard now advances after a successful test, offers "Continuar sin probar" after a failed one, keeps earlier answers and saves only settings.
- Move the panel's shared ambience and server tree scripts and the Commands, Server, Settings and setup wizard scripts out of template strings into `src/panel/scripts/*.js`, checked by ESLint and `tsc` with DOM types and still inlined under the current CSP. Lint found a variable declared twice in the command list and in the settings list renderers. Pages behave the same; `npm run smoke` now checks that the build ships the scripts.
- Exit with code 1 when the TeamSpeak server cannot be reached at startup. The connect timeout ran on a timer that did not keep Node running, so after an ICMP "port unreachable" the process ended with code 0 before the timeout fired, and `Restart=on-failure` left the bot stopped. The same gap could end the process during a reconnect attempt.
- Split `src/main.ts` (1,121 to about 630 lines) into tested modules under `src/bootstrap/`: exit and crash handling, setup mode, the JSON stores, the panel's server view sync, chat command admission, the TeamSpeak reconnect loop, the connected panel's wiring, the playback service's callbacks and the shared yt-dlp options. `main.ts` keeps the startup order. Behavior is unchanged; `npm run smoke` covers startup and shutdown.
- Stop cleanly in setup mode: with TeamSpeak auto-connect off (the installer default until the wizard is completed), SIGTERM and SIGINT had no handler, so `systemctl stop` killed the process with the panel open and the log unflushed. Add `npm run smoke`, which starts the bot in setup mode with throwaway data, checks the panel and stops it; it found this.
- Replace the two command `switch` statements with tables keyed by command name: `COMMANDS` holds each command's help metadata and argument parser, `COMMAND_HANDLERS` its handler. A command missing from either table now fails the type check instead of falling through to "no arguments". Parsing is unchanged, checked against the previous parser on 2,305 inputs.
- Add an optional vote skip, `RHAPSOD_VOTE_SKIP` (default `false`): `!skip` on another user's track counts as a vote, and the track is skipped once more than half of the listeners in the bot's channel voted. Only listeners in that channel vote, and votes reset when the track changes.
- `!help <command>` explains one command with its aliases and category, and each `!help <n>` page names the next category the reader can see. A full category name still wins (`!help cola`), while a command alias now wins over a category prefix (`!help c` is `!clear`).
- Move every chat reply, usage hint and playback error into one catalog, `src/lib/messages.ts`, so wording can be reviewed in one file and a second language can be added later. The texts are unchanged except `!loop` usage, which was the only one still in English.
- Add an autoplay evaluation (`npm run eval:autoplay`) that runs the real DJ rotation over a catalog of mixes and checks repeats, artist spread, energy continuity and the share of new tracks against recorded limits.
- Improve search ranking: short title words ("a", "el") no longer match longer query terms, which let unrelated videos outscore the right one; a query term found only in the channel name counts as matched (Topic channels, BZRP sessions); Spanish reaction videos and "en vivo" or MTV Unplugged cuts are penalized unless the query asks for them. The evaluation floor rises from 96.1% to 100%.
- Add an offline search evaluation (`npm run eval:search`) with 51 cases that pin common traps (covers, live and unplugged versions, sped-up edits, reactions, karaoke, hour-long loops). The test suite keeps ranking accuracy at or above the recorded baseline, 96.1% today.
- Reuse a prepared or cached audio URL only when it stays valid for the whole track (and, for the next tracks, from when they would start): a URL about to expire is resolved again before playback instead of failing with a 403 mid-song.
- Resume a track whose stream stalls mid-song, at the position where it stopped and with a freshly resolved URL, instead of skipping it with an error; radio rejoins the live edge. A second stall in the same play still skips.
- Serve `GET /api/metrics` on the panel in Prometheus text format: plays by end reason, start delay and handoff gap histograms, prewarmed handoffs, underruns, rebuffers, cache and prefetch results, yt-dlp jobs, memory and uptime. It uses the panel's basic auth and loopback bind.
- Log playback latency per track (`startDelayMs`, `handoffGapMs`, `coldStart`, `prewarmed`) and add a playback indicators block to `scripts/log-stats.mjs`: time from a command to the first audio, the gap between tracks, underruns per track and the prewarm hit rate.
- Document what Rhapsod stores per TeamSpeak user, for how long, and how to delete one user's data, in `docs/privacy.md`.
- Run the event-loop watchdog every 15 seconds instead of every 15 minutes, so a stall over 30 seconds restarts the bot instead of one over 30 minutes. The interval is set with `RHAPSOD_WATCHDOG_INTERVAL_SECONDS` (0 disables); `RHAPSOD_WATCHDOG_INTERVAL_MINUTES` is deprecated and only its `0` is honored.
- Send the running version in every outbound User-Agent (`Rhapsod/<version>`, read from `package.json`) instead of the stale `Rhapsod/3.0` and `Rhapsod/1`.
- Spread `!radio` searches across the radio-browser mirrors listed by the project instead of pinning `de1`, moving to another mirror when one fails.
- Keep SoundCloud working when its page changes: the last discovered `client_id` is saved to `data/soundcloud-client-id.json` and used when discovery fails, with a warning in the log, and the user gets a clear message when none is known.
- Coalesce listening-history and song-library saves into one write every five seconds instead of rewriting the whole file on every play start and finish, and read both files at startup instead of during the first track. Shutdown still flushes pending changes.
- Harden `scripts/spotify-auth.mjs`: the callback server listens on 127.0.0.1 only, the authorize URL carries a random `state` and callbacks without it are ignored instead of accepted or ending the flow, and the script now reads `.env` as its message said.
- Send every ffmpeg and ffprobe connection through a local egress guard. Checking the input URL did not cover what ffmpeg opens on its own: a 302 to a plain-HTTP host or an HLS segment on one reached internal addresses such as the cloud metadata service or the yt-dlp daemon. The guard resolves each destination, refuses private addresses and plain HTTP, and prefers IPv4. `no_proxy` is removed from their environment so it cannot bypass the guard.
- Fix the WARP fallback for 403 responses: ffmpeg rejects `-timeout` together with `-http_proxy`, so the fallback attempt exited before connecting.
- Validate the yt-dlp timeouts (`RHAPSOD_YTDLP_SEARCH_TIMEOUT_MS`, `_AUDIO_URL_`, `_DOWNLOAD_`, `_METADATA_`, `_PLAYLIST_`) with the rest of the configuration: they are listed in `.env.example`, editable from the panel, and an out-of-range value stops startup instead of being clamped with a console warning.
- Fix the yt-dlp daemon: youtu.be, `/shorts/` and `/live/` links no longer crash a request, two requests for the same video no longer extract it twice, a request waiting on a stuck extraction gives up after 45 seconds, cached URLs expire at the time signed in the URL (minus 15 minutes) instead of a fixed six hours, and unknown paths answer 404.
- Keep unreadable data files: playlists, favorites, listening history, the song library, telemetry or playback state that fail to parse are renamed to `<name>.corrupt-<time>` instead of being replaced by the next save. Every data write is flushed to disk before the rename, so a power loss cannot leave an empty file.
- Accept `!channel-move` while the bot cannot talk in its channel: it is the command that moves it out, and it used to be ignored with every other command. Move permissions still apply.
- Verify installer and weekly-update downloads against published checksums, use private temp directories instead of fixed `/tmp` paths, create the service user with a `nologin` shell and pin the POT provider server and plugin to the same release. Docker containers run as the unprivileged `node` user and Compose starts the POT provider on loopback.
- Send the parts of a split chat message back to back: another message queued meanwhile can no longer land between them.
- Support aarch64 (arm64) hosts in the installer, such as Oracle Cloud Ampere: Node.js, yt-dlp, static FFmpeg and WARP are fetched for the host architecture, and the weekly update keeps using the matching yt-dlp binary.
- Harden every systemd unit: private devices, protected kernel tunables, modules, logs, control groups and clock, restricted namespaces and address families, no capabilities, `@system-service` syscall filter and a private umask. File access is unchanged.
- Update dependencies: dotenv 18 and libopus-wasm 0.4 (Opus output verified byte-identical), plus compatible Hono, Zod, undici, Vitest, ESLint and Prettier releases. Dependabot no longer proposes `@types/node` majors beyond the supported Node 22 runtime.
- Stop notifying a connection-lost handler after it unsubscribes: kicked and disconnected events are bound once instead of once per subscription.
- Add `scripts/deploy.sh`: waits until nothing is playing, stops the bot, backs up data and the env file, builds the target as the service user, starts it and rolls back to the previous commit on its own when the build or the start fails.
- Add `RHAPSOD_SKIP_NON_MUSIC` (default `false`): YouTube music videos start where the music starts and end where it ends, using the non-music segments (spoken intros, scenes, credits) that SponsorBlock users mark with the `music_offtopic` category. Only an intro and an outro are cut, never a segment in the middle, and a cut that would keep less than half the track or less than 30 seconds is ignored. The lookup sends a 4-character prefix of the SHA-256 of the video id, waits at most 1.5 seconds and runs in parallel with the audio URL; when it fails the track plays whole.

## Upgrade

This is a major release because it removes commands: `!bassboost`, `!nightcore`, `!vaporwave`, `!8d`, `!filter` and `!effects` now get the unknown-command reply. `!test-tone` and `!chart`, previously also reachable as `!effects test-tone` and `!effects chart`, remain as their own commands. A filter saved in `data/state.json` is ignored.

Node.js >=22.19.0 is required. Back up configuration and data, run `npm ci` and `npm run build`, and restart when `/api/state` reports `playerState: "idle"`.

If the panel uses a default password it will not start; set a unique `RHAPSOD_PANEL_PASSWORD` first. Existing installs keep the old `Requires=` line in `/etc/systemd/system/rhapsod.service` until the installer runs again: change it to `Wants=` and run `systemctl daemon-reload`.

Docker installs: run `sudo chown -R 1000:1000 data .env` before recreating the containers, which now run as uid 1000.

The watchdog now defaults to 15 seconds. An env file with `RHAPSOD_WATCHDOG_INTERVAL_MINUTES=15` keeps working and logs a deprecation warning; replace that line with `RHAPSOD_WATCHDOG_INTERVAL_SECONDS=15`, or set it to `0` to keep the watchdog off.

A yt-dlp timeout outside its range now stops startup. Before restarting, compare any `RHAPSOD_YTDLP_*_TIMEOUT_MS` line from `grep TIMEOUT_MS /etc/rhapsod.env` with the ranges in `.env.example`.

Docker Compose uses Linux host networking to keep the panel and daemon on localhost. Review the deployment guide before recreating containers. Existing data formats remain supported.

## Verification

Run `npm run check` and `npm run test:coverage`. Test an idle restart before using favorites or stats, then confirm existing preferences and listening history remain available. Check playback, radio, panel settings and daemon fallback in the target deployment.
