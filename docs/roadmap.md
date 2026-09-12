# Roadmap

[Español](roadmap.es.md)

The active line is 3.x. Published behavior is recorded in [releases](releases.md); changes awaiting release belong in [unreleased notes](releases/unreleased.md). Historical 1.x and 2.x profiles are retained for reference.

## Delivered

- Shared queues, saved playlists, effects and persistent playback state.
- Local administration panel, setup wizard and deployment tooling.
- Per-user favorites, preferred search source, listening statistics and adaptive autoplay.
- Radio search, live station titles, multi-instance directories and duplicate-start detection.
- Separate queue/controller modules, prepared URLs, cancellation epochs and bounded provider waits.

## Open features

- [TeamSpeak 6 adapter (#12)](https://github.com/Juanzaan/rhapsod/issues/12): implement and verify voice/chat behavior behind the existing connection contract.
- [Welcome announcements (#21)](https://github.com/Juanzaan/rhapsod/issues/21): define channel-entry behavior and optional audio without interrupting music.

These items have no promised release date. Issue discussions define acceptance criteria before implementation.

## Maintenance priorities

- Keep runtime requirements, lockfiles, installer and container environments aligned.
- Exercise reconnect and talk-power behavior against real TeamSpeak servers in addition to mocked tests.
- Continue extracting startup wiring into testable modules when behavior changes justify it.
- Validate provider changes with bounded requests and observable failure states.
- Maintain matching English/Spanish docs and reviewed notes for every release.

## Constraints

Spotify is metadata-only. DRM restrictions are not bypassed. The panel stays authenticated and localhost-only. Personalization must preserve queue ownership, user control and predictable stop behavior.
