# Releases

[Español](releases.es.md)

[GitHub Releases](https://github.com/Juanzaan/rhapsod/releases) contains published versions. Release titles use `Rhapsod vX.Y.Z`. Each body has an English summary, changes, upgrade instructions and verification procedure, followed by the same information in Spanish. Source links point to the exact tag and previous release.

## Archive

| Release                              | Focus                                      |
| ------------------------------------ | ------------------------------------------ |
| [Unreleased](releases/unreleased.md) | Pending changes                            |
| [v3.0.0](releases/v3.0.0.md)         | Preferences, autoplay, radio and instances |
| [v2.4.1](releases/v2.4.1.md)         | Release automation                         |
| [v2.4.0](releases/v2.4.0.md)         | Handoffs, loudness and resolver watchdog   |
| [v2.3.1](releases/v2.3.1.md)         | Panel reliability                          |
| [v2.3.0](releases/v2.3.0.md)         | Panel and installer                        |
| [v2.2.0](releases/v2.2.0.md)         | Innertube and daemon                       |
| [v2.1.0](releases/v2.1.0.md)         | Playlists and effects                      |
| [v2.0.0](releases/v2.0.0.md)         | Larger-host deployment profile             |
| [v1.2.1](releases/v1.2.1.md)         | Final low-resource release                 |
| [v1.2.0](releases/v1.2.0.md)         | Playback and reconnect fixes               |
| [v1.1.0](releases/v1.1.0.md)         | Audio and queue controls                   |
| [v1.0.0](releases/v1.0.0.md)         | Initial stable release                     |

Historical summaries describe their tagged code; verification sections are procedures, not claims that old releases were retested today. Original implementation detail remains in [CHANGELOG.md](../CHANGELOG.md) and the linked diffs.

## Prepare a release

1. Update both `docs/releases/unreleased.md` and `docs/releases/unreleased.es.md` as changes land. Describe user-visible behavior and required operator actions.
2. In the release-please PR, copy the reviewed notes to `docs/releases/vX.Y.Z.md` and `.es.md`, update their language links, and append the tag and previous tag to `docs/releases/index.json`.
3. Update the hand-written changelog for that version. Reset both unreleased documents for the next cycle with meaningful pending-status text.
4. Run `npm run check` and `npm run test:coverage`. Preview with `npm run release:notes -- render vX.Y.Z`.
5. Merge the release PR after CI passes. release-please owns the version, tag and GitHub release; the workflow then replaces its generated body with the reviewed bilingual notes.

The publisher refuses to use unarchived notes for an unknown tag. This prevents a release from silently receiving notes for a different version. If publication fails, complete the archive and rerun synchronization for the existing tag.

## Correct published notes

Edit both archived language files, validate them, then use authenticated GitHub CLI access:

```bash
npm run lint:docs
npm run release:notes -- render v3.0.0
npm run release:notes -- sync v3.0.0
```

Synchronization edits only the existing release title and body and reads them back to verify the result. It does not create tags or releases. Repeated synchronization is a no-op when content matches. Keep historical facts tied to their original version; link later fixes explicitly.
