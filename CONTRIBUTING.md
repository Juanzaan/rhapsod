# Contributing

[Español](CONTRIBUTING.es.md)

1. Open an issue for behavior changes or substantial implementation work.
2. Create a focused branch from `main`.
3. Add or update tests with the implementation.
4. Run `npm run check` locally.
5. Open a pull request using the repository template.

Use Node.js >=22.19.0 and install with `npm ci`. Run `npm run test:coverage`
for runtime changes. Documentation under `docs/` and the README must have
matching English and Spanish files with language links at the top.

Update both pending release notes for user-visible changes. Follow
[the release guide](docs/releases.md) when preparing a release PR.

Use Conventional Commits, for example `feat(ts3): connect voice client` or
`fix(queue): reject duplicate track identifiers`.

Do not commit `.env`, credentials, media files, build output, or dependency
directories.
