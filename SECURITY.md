# Security Policy

[Español](SECURITY.es.md)

## Supported versions

Only the latest stable release receives security fixes. Fixes land on `main`
and ship in the next 3.x patch or minor release.

| Version | Supported         |
| ------- | ----------------- |
| 3.x     | Yes (latest only) |
| 2.x     | No                |
| 1.x     | No                |
| < 1.0   | No                |

## Reporting a vulnerability

Do **not** open a public issue for credentials exposure, remote code
execution, authentication bypasses or other exploitable vulnerabilities. Use
GitHub's private vulnerability reporting instead:

1. Go to <https://github.com/Juanzaan/rhapsod/security/advisories>.
2. Provide affected versions, reproduction steps, impact and any known
   mitigations.
3. Never include real TeamSpeak credentials, yt-dlp cookies, panel passwords
   or Spotify tokens in the report.

Reports are acknowledged within 5 business days, with a timeline for the fix
and disclosure once a patch is released.

## Project security posture

- **Secrets** (TeamSpeak passwords, panel password, yt-dlp cookies, Spotify
  client secret and refresh token) live only in `.env` or the deployment
  secret store, never in Git. The installer creates `.env` with mode 0600.
- **No shell execution**: `ffmpeg`, `ffprobe` and `yt-dlp` receive their
  arguments directly; Rhapsod never invokes a shell. The binary paths are
  read-only from the panel.
- **Panel**: bound to `127.0.0.1` and reached through an SSH tunnel, behind
  basic auth. Writes must be same-origin JSON, the panel refuses to start
  with a published default password, and it can only write known `RHAPSOD_*`
  keys, validated with the startup rules.
- **Outbound fetches**: user-supplied URLs go through an SSRF guard that
  rejects private, loopback and link-local addresses at every redirect hop.
- **Content rights**: DRM-protected or blocked tracks are reported with a
  clear message, never bypassed.
- **Spotify**: metadata only, never a playback source. The client
  credentials flow covers tracks, albums and public playlists. An optional
  user refresh token (`RHAPSOD_SPOTIFY_REFRESH_TOKEN`, created with
  `node scripts/spotify-auth.mjs`) grants `playlist-read-private` so the bot
  can read playlists the owner can see; it is used for nothing else.
- **Least privilege**: the systemd units run as a dedicated user with
  `NoNewPrivileges` and `PrivateTmp`; the yt-dlp daemon adds
  `ProtectSystem=strict` and `ProtectHome=read-only`. The bot needs only
  join, speak and chat permissions on the TeamSpeak server.
