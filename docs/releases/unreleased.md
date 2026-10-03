[Español](unreleased.es.md)

## Summary

The Windows tray app no longer leaves a blank panel window when the tunnel passes only the headers of each answer.

## Changes

- Windows app: the panel window opens after a full status answer. Two answers in a row cut after the headers switch the app to a relay over `ssh -W`, with a notice recommending the Windows OpenSSH client. Seen with the Git for Windows `ssh.exe`.

## Upgrade

No action is required beyond the v4.1.0 upgrade steps.

## Verification

Run `npm run check` and `npm run test:coverage`.
