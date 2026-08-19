# Commands

Rhapsod commands use `!` by default. Commands are processed in TeamSpeak text
chat once the TS3 adapter is connected.

| Command                     | Alias                 | Description                                                                                         |
| --------------------------- | --------------------- | --------------------------------------------------------------------------------------------------- |
| `!play <URL or search>`     | `!p`                  | Resolve a YouTube video/playlist, SoundCloud, Spotify, Apple Music or Amazon Music link, or search. |
| `!playnext <URL or search>` | `!pn`, `!next`        | Add a single track or search result at the front of the pending queue.                              |
| `!yt <search terms>`        | `!search`, `!youtube` | Add the first matching YouTube video to the queue.                                                  |
| `!pause`                    | -                     | Pause the current track.                                                                            |
| `!resume`                   | -                     | Resume the current track.                                                                           |
| `!skip`                     | `!s`                  | Skip the current track.                                                                             |
| `!stop`                     | -                     | Stop playback and disconnect the player from the current track.                                     |
| `!queue [page]`             | `!q`                  | Show 10 pending tracks per page with per-track durations.                                           |
| `!history`                  | `!hist`               | Show the 10 most recently started tracks (up to 20 are kept in memory).                             |
| `!now-playing`              | `!np`, `!now`         | Show the current track, duration and requester.                                                     |
| `!stats`                    | `!st`                 | Show uptime, tracks played since start, current track, queue length and volume/loop state.          |
| `!volume <0-100>`           | `!vol`, `!v`          | Adjust the bot output volume (default `50`; persists in `state.json`).                              |
| `!move <from> <to>`         | `!mv`                 | Move a pending track between one-based positions.                                                   |
| `!remove <n\|from-to>`      | `!rm`                 | Remove one position or an inclusive range (requesters may remove only their own tracks).            |
| `!clear`                    | `!c`                  | Clear pending tracks.                                                                               |
| `!shuffle`                  | -                     | Shuffle the pending queue (the current track keeps playing).                                        |
| `!loop [off\|track\|queue]` | -                     | Repeat the current track (`track`) or the whole queue (`queue`); persists in `state.json`.          |
| `!lyrics`                   | `!ly`                 | Show the lyrics of the current track, found via LRCLIB (best-effort, no account).                   |
| `!test-tone`                | `!tone`               | Play a 3-second test tone (rate-limited).                                                           |
| `!help`                     | `!h`                  | Show the command summary.                                                                           |

## Source behavior

- **Permissions:** every command is open to everyone. `RHAPSOD_ADMIN_UIDS`
  only grants admins the ability to remove tracks requested by other users
  with `!remove`; requesters can always remove their own tracks.
- **Persistence:** `!volume` (default `50`) and `!loop` are saved to
  `data/state.json` (atomic write) and restored at startup; `!stop`/`!clear`
  reset looping and persist the change.
- **Queue editing:** `!playnext` promotes one resolved track ahead of every
  pending track; YouTube playlists must use `!play`. `!move` rejects missing
  source/destination positions. `!remove a-b` removes an inclusive range and
  caps ranges that extend beyond the queue end.
- **YouTube:** Rhapsod uses a local `yt-dlp` executable to obtain metadata and
  a temporary audio URL immediately before playback. Search returns the first
  matching video; playlists add up to 20 tracks per `!play` (duplicates already
  in the queue are skipped) and report how many were added.
- **SoundCloud:** individual tracks first use SoundCloud's public web API with
  a dynamically discovered, cached client identifier. The identifier refreshes
  after authorization failures; yt-dlp and YouTube alternatives remain
  fallbacks. This unofficial API may change without notice. Playlists are not
  expanded yet, and blocked/DRM tracks are never bypassed.
- **Spotify:** tracks are resolved through the official Web API (client
  credentials flow, no user login) and the matching "artist title" is searched
  on YouTube for playback. Playlists and albums expand up to 20 tracks per
  `!play` (paged requests with 429 backoff, duplicates skipped).
- **Apple Music / Amazon Music:** these services have no public audio API, so
  links are resolved through SongLink (Odesli), preferring the YouTube
  equivalent (playlists included) and falling back to SoundCloud. If nothing
  playable exists, `!play` says so instead of guessing.
- **Search text:** `!play` accepts free text and runs the same YouTube search
  as `!yt` (fuzzy term matching, channel credits, and a shortened retry when
  nothing is reliable).
- **Other sources:** local files and direct HTTPS audio URLs are rejected with
  a clear message.

No command may accept shell syntax. Rhapsod passes provider arguments directly
to child processes and never invokes a shell.
