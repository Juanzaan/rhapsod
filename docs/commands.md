# Commands

Rhapsod commands use `!` by default. Commands are processed in TeamSpeak text
chat once the TS3 adapter is connected.

| Command                     | Alias         | Description                                                     |
| --------------------------- | ------------- | --------------------------------------------------------------- |
| `!play <URL or search>`     | `!p`          | Resolve a YouTube video, SoundCloud track, YouTube playlist, or search. |
| `!yt <search terms>`        | `!search`     | Add the first matching YouTube video to the queue.              |
| `!pause`                    | -             | Pause the current track.                                        |
| `!resume`                   | -             | Resume the current track.                                       |
| `!skip`                     | `!s`          | Skip the current track.                                         |
| `!stop`                     | -             | Stop playback and disconnect the player from the current track. |
| `!queue`                    | `!q`          | Show the pending queue.                                         |
| `!now-playing`              | `!np`, `!now` | Show the current track and requester.                           |
| `!volume <0-100>`           | `!vol`, `!v`  | Reserved; PCM volume control is not connected yet.              |
| `!remove <position>`        | `!rm`         | Remove a one-based queue position.                              |
| `!clear`                    | `!c`          | Clear pending tracks.                                           |
| `!loop [off\|track\|queue]` | -             | Reserved; loop modes are not connected yet.                     |
| `!help`                     | `!h`          | Show the command summary.                                       |

## Source behavior

- **YouTube:** Rhapsod uses a local `yt-dlp` executable to obtain metadata and
  a temporary audio URL immediately before playback. Search returns the first
  matching video; playlists add up to 20 tracks per `!play` (duplicates already
  in the queue are skipped) and report how many were added.
- **SoundCloud:** individual tracks first use SoundCloud's public web API with
  a dynamically discovered, cached client identifier. The identifier refreshes
  after authorization failures; yt-dlp and YouTube alternatives remain
  fallbacks. This unofficial API may change without notice. Playlists are not
  expanded yet, and blocked/DRM tracks are never bypassed.
- **Search text:** `!play` accepts free text and runs the same YouTube search
  as `!yt` (fuzzy term matching, channel credits, and a shortened retry when
  nothing is reliable).
- **Other sources:** Spotify links, local files, and direct HTTPS audio URLs
  are rejected with a clear message; Spotify resolution is planned.

No command may accept shell syntax. Rhapsod passes provider arguments directly
to child processes and never invokes a shell.
