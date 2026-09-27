# Desktop launcher (Windows)

[Español](desktop.es.md)

`tools/desktop` holds a small Windows launcher for the panel. It opens the SSH tunnel to the bot host, waits for the panel port, opens the browser and copies the panel password to the clipboard. The host, key path and ports live in `%APPDATA%\Rhapsod\dashboard.conf`; the panel password lives in the Windows Credential Manager, encrypted for the current Windows user. Nothing is compiled into the executable.

## Build

The launcher targets .NET Framework 4, which every supported Windows includes, so no SDK is required:

```powershell
powershell -ExecutionPolicy Bypass -File tools\desktop\build.ps1
```

The executable is written to `tools\desktop\bin\RhapsodDashboard.exe`. CI builds the same file on every pull request and keeps it as the `rhapsod-dashboard` artifact.

## First run

Run `RhapsodDashboard.exe`. It asks for:

- the SSH target, for example `rhapsod@203.0.113.10`;
- the private key that the bot host accepts, for example `%USERPROFILE%\.ssh\id_ed25519`;
- the panel user, the local port and the panel port on the host (8080 by default);
- the panel password, typed hidden and saved in the Credential Manager.

Later runs connect directly. The window must stay open while the panel is in use; closing it, pressing `Q` or `Ctrl+C` shuts the tunnel, because ssh runs in a Windows job that ends with the launcher. The password is removed from the clipboard after 30 seconds if it is still there.

When the local port is already open, the launcher reuses it only if it answers like the panel (a Basic authentication challenge). Another program on that port stops the launcher before it opens the browser or copies the password; pick another port with `--setup`.

## Options

- `--setup` asks for every setting and the password again.
- `--forget` deletes the saved password for the configured host.

The launcher uses the Windows OpenSSH client when installed, otherwise the `ssh.exe` from Git for Windows or the first one on `PATH`.

## Replacing an older launcher

Launchers built before this one embedded the panel password in the executable. Delete them, set a new `RHAPSOD_PANEL_PASSWORD` on the host, restart the bot while idle, and run this launcher with `--setup`.
