# Desktop app (Windows)

[Español](desktop.es.md)

`tools/desktop` holds Rhapsod Dashboard, a small Windows tray app for the panel. It keeps the SSH tunnel to the bot host open, reconnects it when it drops, shows what the bot is playing and opens the panel in its own window. The host, key path and ports live in `%APPDATA%\Rhapsod\dashboard.conf`; the panel password lives in the Windows Credential Manager, encrypted for the current Windows user. Nothing is compiled into the executable.

## Build

The app targets .NET Framework 4, which every supported Windows includes, so no SDK is required:

```powershell
powershell -ExecutionPolicy Bypass -File tools\desktop\build.ps1
```

The executable is written to `tools\desktop\bin\RhapsodDashboard.exe`. CI builds the same file on every pull request, runs its self-test and keeps it as the `rhapsod-dashboard` artifact.

## First run

Run `RhapsodDashboard.exe`. A settings window asks for:

- the SSH target, for example `rhapsod@203.0.113.10`;
- the private key that the bot host accepts, for example `%USERPROFILE%\.ssh\id_ed25519`;
- the panel user and password;
- the local port and the panel port on the host (8080 by default).

After saving, the app sits in the notification area and opens the panel once the tunnel is up. Later runs start directly.

## Tray icon

The icon color shows the state: green while a track plays, grey when connected and idle, amber while connecting or when the bot is not connected to TeamSpeak, red when the tunnel is down. Hovering shows the current track.

- Double-click or **Abrir panel** opens the panel in an app window of Edge, Chrome or Brave (the first one installed), with a separate profile so the panel login never mixes with the everyday browser. Without a Chromium browser, it opens in the default browser.
- Opening the panel copies the password to the clipboard and removes it after 30 seconds if it is still there. **Copiar contraseña** copies it again.
- **Reconectar** restarts the tunnel; **Configuración…** edits the settings and reconnects; **Salir** closes the tunnel and the app.

When the tunnel drops, the app notifies and retries after 5, 10, 20, 40 and then every 60 seconds. ssh runs in a Windows job that ends with the app, so quitting always closes the tunnel. Starting the app again while it runs brings up the panel instead of a second copy.

When the local port is already open, the app reuses it only if it answers like the panel (a Basic authentication challenge). Another program on that port keeps the app offline with a notification; pick another port in **Configuración…**.

## Options

- `--setup` opens the settings window before starting.
- `--forget` deletes the saved password for the configured host.
- `--self-test FILE` runs the checks CI uses and writes a report to `FILE`.

The app uses the Windows OpenSSH client when installed, otherwise the `ssh.exe` from Git for Windows or the first one on `PATH`.

## Replacing an older launcher

Launchers built before this app embedded the panel password in the executable. Delete them, set a new `RHAPSOD_PANEL_PASSWORD` on the host, restart the bot while idle, and enter the new password in **Configuración…**.
