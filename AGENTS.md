# AGENTS.md

Guidance for AI agents (and humans) working in this repository.

## What this is

Rhapsod is a self-hosted music bot for TeamSpeak 3 (TS6 planned). TypeScript,
Node >= 22.12, ESM throughout. Voice: TS3 query + Opus via libopus-wasm;
playback: FFmpeg; sources: YouTube (yt-dlp + innertube), SoundCloud, Spotify
(metadata only, never playback); owner surface: Hono web panel bound to
localhost.

## The one command that matters

```bash
npm run check
```

Runs, in order: `format:check` (prettier) → `lint` (eslint, zero warnings
allowed) → `lint:scripts` (custom checker for shell/systemd files) →
`typecheck` (tsc --noEmit) → `test` (vitest, ~750 tests) → `build`
(tsc -p tsconfig.build.json).

**Never report work done without this passing.** CI runs the same gates plus
coverage; a red CI means the claim of "done" was wrong.

Useful subsets: `npx vitest run tests/<file>.test.ts` for one suite,
`npm run dev` to run the bot locally (needs `.env`, see `.env.example`).

## Conventions

- **Conventional commits, always**: `fix(panel): ...`, `feat(playback): ...`,
  `docs: ...`, `ci: ...`, `chore(deps): ...`. release-please derives versions
  from these types; `feat` → minor, `fix` → patch, anything else → no bump.
  Scope names in use: panel, playback, ts3, search, audio, daemon, commands,
  ci, deps, release, changelog.
- **Tests alongside changes.** A bug fix gets a regression test that fails
  against the old code (see the content-length tests in
  `tests/panel-server.test.ts` for the pattern). New features get coverage in
  the same PR.
- **ESM imports carry `.js` extensions** even in `.ts` files
  (`./config.js`), because tsc emits ESM directly.
- **Prettier is the only formatter.** Don't hand-align; run
  `npx prettier --write <file>` if `format:check` complains.
- **No comments explaining what code does** unless it explains _why_:
  trade-offs, incidents, non-obvious decisions (see `panel-server.ts` gzip
  comment for the bar).
- **User-facing chat strings are in Spanish** ("Reproduciendo:", "Cola:").
  Code and identifiers: English, always. Docs: bilingual, see below.

## Docs (`docs/`, `README.md`, `CHANGELOG.md`)

- **Two files, two languages.** Every user-facing doc ships in English
  (`install.md`) and neutral Spanish (`install.es.md`), cross-linked at the
  top. Update both in the same PR; changing one without the other is an
  incomplete PR. (`CHANGELOG.md` stays English-only: Keep-a-Changelog
  convention, and release-please reads it.)
- **Neutral Spanish, no demonyms.** No voseo, no regional slang, no
  country-specific references: nothing in the text may reveal where the
  author is from. Prefer the infinitive in instructions ("Pegar el
  archivo", never "Pega/Pegá el archivo").
- **Write like a developer, not a model.** Hard bans, enforced in review:
  - Slop vocabulary: delve, leverage, utilize, robust, seamless, ecosystem,
    holistic, groundbreaking, cutting-edge, empower, unlock, realm,
    tapestry, paradigm, synergy, landscape, moreover, furthermore,
    comprehensive, meticulous. Use the plain word (use, full, strong) or
    delete the word.
  - Padding with zero information: "it's worth noting", "needless to say",
    "feel free to", "in today's fast-paced", "as you may know".
  - Cliché structures: `Question? Answer.` pairs, "This isn't X, it's Y"
    contrasts, "Whether you're X or Y" appeals, "In a world where" openers.
  - Decorative emojis and emoji checklists. No emojis in docs, ever.
  - Em dashes (—), en dashes (–), curly quotes (" " ' '): plain `-`, `"`,
    `'` instead.
  - Anthropomorphizing code ("the service wants", "ffmpeg tries hard").
  - "Simply", "easy", "just", "quickly" in procedures. If it were simple,
    the doc would not need to exist.
  - Bold marks behavior, paths and commands, never whole sentences.
- **Procedures over prose.** A doc change answers three things: what
  changed, the exact commands/paths/versions, and how to verify. One idea
  per paragraph. Match the formatting density around the edit; never
  restate the diff as bullets (WHAT without WHY is the AI-copilot tell).

## Layout

```
src/
  adapters/ts3/    TeamSpeak connection, identity, probe (LEAST tested — be careful)
  application/     Playback service, queue, playlists, telemetry (best tested)
  audio/           Opus encoder, FFmpeg PCM, loudness, filters
  commands/        Command registry + handlers (!help is auto-generated)
  media/youtube/   yt-dlp wrapper, innertube search, ranking
  panel/           Hono server + HTML templates (localhost-only, basic auth)
  observability/   pino logging, metrics
  lib/             query-parser, ssrf guard, shared utils
  domain/          state store
  config.ts        zod schema: the source of truth for every RHAPSOD_* key
tests/             vitest, colocated mirrors of src
scripts/           yt-dlp daemon (python), lint-scripts, spotify-auth
docs/              install, deployment, commands, roadmap, runbooks
```

## Things that will bite you

- `src/application/youtube-playback-service.ts` is ~2k lines and everything
  playback-related routes through it. Changes there need the full suite, not
  a subset.
- `src/adapters/ts3/` is at ~38% coverage. Recurring production bugs
  (reconnect, talk power) live here. Test before you trust.
- The panel must stay bound to `127.0.0.1` (`RHAPSOD_PANEL_HOST`); it is
  reached through SSH tunnels, never exposed. Any change that weakens the
  bind, the basic auth, or the env-write whitelist needs extra scrutiny.
- The version string is read from `package.json` at startup (dist expects it
  one directory up from `dist/main.js`). Don't reintroduce
  `process.env.npm_package_version`.
- Config changes must update: `src/config.ts` (zod), `.env.example`,
  `ENV_DESCRIPTIONS` in `src/panel/panel-server.ts`, and often
  `docs/install.md`. Four places, one truth.

## Release flow

release-please owns versions, tags and the GitHub release. Conventional
commits on `main` accumulate in the open release PR; merging it tags and
publishes. Manual tags/changelog edits are not needed, and
`skip-changelog: true` in `release-please-config.json` means the CHANGELOG is
hand-written in the release PR, not generated.

Deploy: production runs from `main` on OCI via systemd
(`EnvironmentFile=/etc/rhapsod.env`, `ExecStart=node dist/main.js`). Deploy =
`git pull --ff-only && npm ci && npm run build && systemctl restart rhapsod`.
The bot connects to a live server with real users. Never restart it without
checking nothing is playing (`/api/state` → `playerState`).

## Hard rules

- Never commit `.env`, cookies, identities, or anything from `data/`.
- Never push `--force` to `main` (branch protection enforces linear history).
- DRM/blocked content is reported, never bypassed.
- Spotify is metadata only, never a playback source.
