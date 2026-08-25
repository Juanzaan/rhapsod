# Security Policy

## Supported versions

Only the latest stable release is supported. Security fixes land on `main` and
are backported to the latest release tag when a patch release is required.

| Version | Supported         |
| ------- | ----------------- |
| 2.x     | Yes (latest only) |
| 1.x     | Yes (latest only) |
| < 1.0   | No                |

## Reporting a vulnerability

Do **not** open a public issue for credentials exposure, remote code
execution, authentication bypasses, or other exploitable vulnerabilities. Use
GitHub's private vulnerability reporting feature instead:

1. Go to <https://github.com/Juanzaan/rhapsod/security/advisories>.
2. Provide affected versions, reproduction steps, impact, and any known
   mitigations.
3. Never include real TeamSpeak credentials, yt-dlp cookies, or Spotify
   access tokens in the report.

Acknowledgment happens within 5 business days, with a timeline for the fix and
disclosure once a patch is released.

## Project security posture

- **Secrets** (TS3 passwords, yt-dlp cookies, Spotify credentials) only live in
  `.env` or the deployment secret store, never in Git.
- **No shell execution**: provider arguments are passed directly to child
  processes (`ffmpeg`, `yt-dlp`); Rhapsod never invokes a shell.
- **Content rights**: DRM-protected or blocked tracks are reported with a
  clear message, never bypassed.
- **Privacy**: the Spotify integration uses the client credentials flow only —
  no user login, no user data collection.
- **Least privilege**: the production systemd unit runs with `NoNewPrivileges`,
  `PrivateTmp`, and `ProtectSystem=full`, and the bot needs only join/speak/
  chat permissions on the TeamSpeak server.
