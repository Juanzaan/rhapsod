[Español](unreleased.es.md)

## Summary

Adds a Windows launcher for the panel.

## Changes

- Add a Windows launcher for the panel (`tools/desktop`): it opens the SSH tunnel and the browser, keeps the connection settings in `%APPDATA%` and the panel password in the Windows Credential Manager, and embeds no host or password. CI builds it on Windows.

## Upgrade

No action is required beyond the v4.0.0 upgrade steps.

## Verification

Run `npm run check` and `npm run test:coverage`.
