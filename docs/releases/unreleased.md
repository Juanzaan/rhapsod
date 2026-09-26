[Español](unreleased.es.md)

## Summary

Adds a Windows tray app for the panel.

## Changes

- Add a Windows launcher for the panel (`tools/desktop`): it opens the SSH tunnel and the browser, keeps the connection settings in `%APPDATA%` and the panel password in the Windows Credential Manager, and embeds no host or password. CI builds it on Windows.
- Turn the Windows launcher into a tray app: it reconnects the SSH tunnel on its own, shows what is playing in the icon, opens the panel in its own browser window with a separate profile, runs a single copy and edits its settings in a window. CI runs its self-test.

## Upgrade

No action is required beyond the v4.0.0 upgrade steps.

## Verification

Run `npm run check` and `npm run test:coverage`.
