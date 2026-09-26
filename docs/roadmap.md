# Roadmap

[Español](roadmap.es.md)

The next release is 4.0.0. Published behavior is recorded in [releases](releases.md); changes awaiting release belong in [unreleased notes](releases/unreleased.md). Historical 1.x, 2.x and 3.x profiles are retained for reference.

## Delivered

- Shared queues, saved playlists and persistent playback state.
- Local administration panel, setup wizard and deployment tooling.
- Per-user favorites, preferred search source, listening statistics and autoplay as a DJ (similar tracks, channel classics, discoveries).
- Radio search, live station titles, multi-instance directories and duplicate-start detection.
- Separate queue/controller modules, prepared URLs, cancellation epochs and bounded provider waits.
- Egress guard for ffmpeg and ffprobe, quarantine of unreadable data files, coalesced store writes.

## Planned work (proposal, open for veto)

Items are ordered by user-visible impact divided by risk. Each one ships as its own PR with a regression test, bilingual docs and unreleased notes. Measurement comes first so later tuning can show a before and after. To drop or reorder an item, comment on the roadmap PR; nothing below starts until the plan is merged.

### Phase 1: measure

1. **Playback KPIs.** Record, per track: time from the chat command to the first audio frame, the gap between the end of one track and the start of the next, underruns and rebuffers, and whether the next track was prewarmed. Extend `scripts/log-stats.mjs` with a KPI report (p50/p90/p99 per metric). Impact: every later playback change gets a number. Risk: low, logging only. Files: `playback-controller.ts`, `main.ts`, `scripts/log-stats.mjs`.
2. **Metrics endpoint.** `GET /api/metrics` on the panel in Prometheus text format (counters and the KPI histograms above), behind the existing auth and loopback bind. Impact: dashboards and alerts without log scraping. Risk: low. Files: `panel-server.ts` (agreed with lane A: routes only, the auth middleware stays as is), `observability/metrics.ts`.

### Phase 2: playback

3. **Recover a stalled stream mid-song.** Today a stalled source ends the track as an error and skips it. Restart ffmpeg once at the current position, as the 403 retry already does, before giving up. Regression test: a stream that stalls halfway resumes instead of skipping. Risk: low to medium, reuses the resume path.
4. **URL lifecycle aware of expiry.** Prepared and cached googlevideo URLs carry a signed `expire`. Refresh a prepared URL that expires within the next track's duration plus a margin, before handoff instead of after a 403. Risk: medium. Files: `prepared-audio-store.ts`, `audio-url-cache.ts`.
5. **Gapless handoff tuning.** With the gap numbers from item 1, tune when the next track is prewarmed and keep the warm stream across seeks and queue edits that do not change the next track. Target and scope set by the phase 1 data; skipped if the gap is already under 200 ms at p90. Risk: medium.
6. **Loudness check.** Report measured loudness spread per session from the loudness profiler and adjust the default target or the fallback path only if the spread is audible. Risk: low.

### Phase 3: search and autoplay quality

7. **Offline search evaluation.** `scripts/search-eval.mjs` plus a fixture set of recorded candidate lists for at least 50 real queries (covers, live versions, lyric videos, artist-title swaps, Spanish and English titles) with the expected pick. It scores `search-ranking.ts` and runs as a test that fails on a regression. Ranking changes after this land with a score delta. Risk: low, tooling.
8. **Autoplay evaluation.** A harness that runs the DJ rotation for many turns over recorded related lists and synthetic histories, and reports repeats within a window, the largest share of one artist, and energy jumps between consecutive picks. Tuning follows the same before-and-after rule. Risk: low.

### Phase 4: chat experience

9. **Central messages module.** Move the 56 literal chat strings in `command-handlers.ts` and the ones in the controller into `lib/messages.ts`, one consistent voice, ready for a second language. Risk: low, covered by the handler tests.
10. **Better `!help`.** Now that long messages split, `!help` shows one category per page with a short footer to the next, and `!help <command>` explains a single command with its aliases. Risk: low.
11. **Optional vote skip.** `RHAPSOD_VOTE_SKIP` (off by default): when a non-requester sends `!skip`, it counts as a vote, and the track skips when more than half of the listeners in the bot's channel voted. Needs a method on the TeamSpeak connection that lists the UIDs of regular clients in the bot's channel; lane A adds it first. Risk: medium.

### Phase 5: architecture and tooling

12. **Command registry table.** One entry per command with its spec, parser and handler, replacing the parse switch in `chat-command.ts` and the dispatch switch in `command-handlers.ts`. `!help` and the panel command list read the same table. Risk: medium, touches every command; the existing parser and handler tests must pass unchanged.
13. **Smoke script.** `scripts/smoke.mjs` builds, boots the bot in setup mode with a temporary data directory, calls the panel health and state endpoints, and shuts it down. Runs in CI. Risk: low.
14. **Split `main.ts`.** Extract the wiring into modules with tests: storage, playback stack, panel, shutdown. `main.ts` keeps only the order of startup. Risk: medium; done after items 12 and 13 so the smoke script guards it.
15. **Panel scripts as real files.** Move the dashboard's inline JavaScript out of template strings into files that ESLint and `tsc` check, still served inline to keep the current CSP. Risk: medium, the dashboard is large; done last in this phase.
16. **Fake TeamSpeak harness (lane A).** A scripted server or recorded fixtures to exercise the TeamSpeak adapter and the startup wiring without a live server. Belongs to `src/adapters/ts3/`; taken by the lane A session.

### Proposed by lane A (open for veto)

18. **Windows desktop companion.** `tools/desktop` (C#, WinForms and WebView2): SSH tunnel manager, embedded panel, tray status, safe restart and update. It signs in with short-lived panel tokens issued over SSH instead of a password stored in the program. The token support changes the panel auth after item 2 merges.
19. **Deploy script.** `scripts/deploy.sh`: wait until nothing plays, back up, pull, build, restart, and roll back when the new build fails to start.
20. **CI hardening.** `systemd-analyze verify` for the units, `shellcheck` for the scripts, a Windows runner, and actions pinned by commit SHA.

### Proposal only: storage

17. **SQLite.** Recommendation: keep the JSON stores for now. Since #104 and #113, unreadable files are quarantined and writes are coalesced, and the largest store, listening history, is capped at 50,000 entries per user. `node:sqlite` is still experimental on Node 22, the minimum supported runtime. Revisit when a store needs queries the JSON files cannot answer, or the history file passes about 20 MB. A migration would import each JSON file once at startup into one database, keep the JSON file as a backup, and be released as a major version.

## Open features

- [TeamSpeak 6 adapter (#12)](https://github.com/Juanzaan/rhapsod/issues/12): implement and verify voice/chat behavior behind the existing connection contract.
- [Welcome announcements (#21)](https://github.com/Juanzaan/rhapsod/issues/21): define channel-entry behavior and optional audio without interrupting music.

These items have no promised release date. Issue discussions define acceptance criteria before implementation.

## Maintenance priorities

- Keep runtime requirements, lockfiles, installer and container environments aligned.
- Exercise reconnect and talk-power behavior against real TeamSpeak servers in addition to mocked tests.
- Validate provider changes with bounded requests and observable failure states.
- Maintain matching English/Spanish docs and reviewed notes for every release.

## Constraints

Spotify is metadata-only. DRM restrictions are not bypassed. The panel stays authenticated and localhost-only. Personalization must preserve queue ownership, user control and predictable stop behavior.
