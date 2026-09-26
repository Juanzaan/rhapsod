# Data and privacy

[Español](privacy.es.md)

Rhapsod keeps what it learns about TeamSpeak users in JSON files under `RHAPSOD_DATA_DIR` (`/var/lib/rhapsod` in the systemd layout, `/home/rhapsod/rhapsod/data` for the installer, `<RHAPSOD_DATA_DIR>/instances/<id>/` with `RHAPSOD_INSTANCE_ID`). Nothing leaves the host: there is no analytics service. Users are identified by their TeamSpeak unique ID (UID).

## What is stored per user

| File                     | Per UID                                                                                                                                                                                               | Limit                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `user-telemetry.json`    | Every nickname seen, server group IDs, highest talk power, first and last time seen, last channel ID, number of commands sent, times the user moved the bot, times the user entered the bot's channel | None: one entry per UID ever seen, kept until deleted by hand         |
| `listening-history.json` | Per track: plays, completes, skips, last play time; the list of plays with time and whether they finished                                                                                             | 50,000 tracks and 50,000 plays per user; the oldest are dropped first |
| `user-preferences.json`  | Favorites and the preferred search source                                                                                                                                                             | 50 favorites                                                          |
| `playlists.json`         | Saved playlists                                                                                                                                                                                       | 20 playlists of 200 tracks                                            |
| `state.json`             | Nickname and UID of whoever requested each track in the current queue                                                                                                                                 | Only the queue at the last save                                       |

Files without user data: `song-library.json` (every track the bot played, no requester), `audio-url-cache.json`, `soundcloud-client-id.json` and `ts3-identity.txt`, the bot's own identity. The global counts in `listening-history.json` (used by `!tops` and autoplay) carry no UID.

## Logs and memory

Every chat command is logged with its text, the sender's nickname and UID. Logs live in `<RHAPSOD_DATA_DIR>/logs/` and are deleted after `RHAPSOD_LOG_RETENTION_DAYS` days (default 14, range 1-90). Under systemd, the journal keeps its own copy of the service output with the system's journal retention.

The panel's chat view keeps the last 50 channel messages in memory only; a restart clears them.

## Outside services

With `RHAPSOD_SKIP_NON_MUSIC=true`, each YouTube track is looked up on `sponsor.ajay.app` (SponsorBlock). The request carries the first 4 characters of the SHA-256 of the video id, which match many unrelated videos, and no TeamSpeak user data. With the default `false` no request is made.

## Delete a user's data

1. Find the UID from a nickname the bot has seen:

   ```bash
   cd /var/lib/rhapsod
   sudo -u rhapsod node -e '
   const users = require("./user-telemetry.json").users;
   for (const user of Object.values(users))
     if (user.names.includes(process.argv[1])) console.log(user.uid);
   ' 'Nickname'
   ```

2. Wait until nothing is playing (`/api/state` reports `playerState: "idle"`) and stop the bot:

   ```bash
   sudo systemctl stop rhapsod
   ```

3. Remove the UID from every file that stores it. Replace `UID_HERE` and run as the service user from the data directory:

   ```bash
   sudo -u rhapsod node -e '
   const fs = require("node:fs");
   const uid = process.argv[1];
   const edits = {
     "user-telemetry.json": (d) => delete d.users?.[uid],
     "listening-history.json": (d) => delete d.users?.[uid],
     "user-preferences.json": (d) => delete d.users?.[uid],
     "playlists.json": (d) => delete d.playlists?.[uid],
   };
   for (const [file, edit] of Object.entries(edits)) {
     if (!fs.existsSync(file)) continue;
     const data = JSON.parse(fs.readFileSync(file, "utf8"));
     edit(data);
     fs.writeFileSync(file, JSON.stringify(data));
     console.log(`updated ${file}`);
   }
   ' 'UID_HERE'
   ```

4. Check that no file still names the UID; each count must be `0`:

   ```bash
   grep -c 'UID_HERE' user-telemetry.json listening-history.json user-preferences.json playlists.json
   ```

5. Remove log lines that name the UID, or wait for retention to drop them: `grep -l 'UID_HERE' logs/*` lists the files.
6. Start the bot: `sudo systemctl start rhapsod`.

`state.json` is not edited: it only holds the current queue, and the user's name leaves it as those tracks play or are removed. Backups made before the deletion still contain the data; see [deployment](deployment.md) for where they are kept. To delete everything for all users, stop the bot and remove the five files in the table above.

## Verify

After the restart, `journalctl -u rhapsod -n 50 --no-pager` shows no `set aside` warning for the edited files; a malformed edit would have been moved to `<name>.corrupt-<time>`. The user gets a new telemetry entry the next time the bot sees them on the server.
