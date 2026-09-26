# Roadmap

[Español](roadmap.es.md)

The current release is 4.0.0. Published behavior is recorded in [releases](releases.md); changes awaiting release belong in [unreleased notes](releases/unreleased.md). Historical 1.x, 2.x and 3.x profiles are retained for reference.

## Delivered

- Shared queues, saved playlists and persistent playback state.
- Local administration panel, setup wizard and deployment tooling.
- Per-user favorites, preferred search source, listening statistics and autoplay as a DJ (similar tracks, channel classics, discoveries).
- Radio search, live station titles, multi-instance directories and duplicate-start detection.
- Separate queue/controller modules, prepared URLs, cancellation epochs and bounded provider waits.
- Egress guard for ffmpeg and ffprobe, quarantine of unreadable data files, coalesced store writes.

### Delivered in 4.0.0 from the round 3 plan

The numbers keep the order of the plan approved in #124.

- **1.** Playback KPIs per track and a report in `scripts/log-stats.mjs` (#126).
- **2.** `GET /api/metrics` in Prometheus text format (#127).
- **3.** Resume a stream that stalls mid-song (#128).
- **4.** Reuse prepared URLs only while they last the whole track (#129).
- **7.** Offline search evaluation with a regression floor (#130, #131).
- **8.** Autoplay evaluation (#132).
- **9.** One catalog for chat texts (#133).
- **10.** `!help <command>` and a pointer to the next category (#135).
- **11.** Optional vote skip, `RHAPSOD_VOTE_SKIP` (#136, with #125 from lane A).
- **12.** Table-driven command registry (#137).
- **13.** `npm run smoke`, run by the test suite (#140).
- **14.** `src/main.ts` split into tested modules under `src/bootstrap/` (#142 to #149).
- **19.** `scripts/deploy.sh` with automatic rollback (#138, lane A).

## Planned work

Each item ships as its own PR with a regression test, bilingual docs and unreleased notes.

- **5. Gapless handoff tuning.** With the gap numbers from item 1, tune when the next track is prewarmed and keep the warm stream across seeks and queue edits that do not change the next track. Target and scope set by production data from `scripts/log-stats.mjs`; skipped if the gap is already under 200 ms at p90. Risk: medium.
- **6. Loudness check.** Report measured loudness spread per session from the loudness profiler and adjust the default target or the fallback path only if the spread is audible. Risk: low.
- **15. Panel scripts as real files.** In progress: the ambience, server tree, Commands, Server, Settings and setup wizard scripts live in `src/panel/scripts/` (#151 to #155), which also exposed the setup wizard bugs fixed in #156. The dashboard script is next. Risk: medium, the dashboard is large.
- **16. Fake TeamSpeak harness (lane A).** A scripted server or recorded fixtures to exercise the TeamSpeak adapter and the startup wiring without a live server. Belongs to `src/adapters/ts3/`; taken by the lane A session.

### Proposed by lane A (open for veto)

- **18. Windows desktop companion.** `tools/desktop` (C#, WinForms and WebView2): SSH tunnel manager, embedded panel, tray status, safe restart and update. It signs in with short-lived panel tokens issued over SSH instead of a password stored in the program. The token support changes the panel auth after item 2 merges.
- **20. CI hardening.** `systemd-analyze verify` for the units, `shellcheck` for the scripts, a Windows runner, and actions pinned by commit SHA.

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
