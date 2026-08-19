# Commands

Rhapsod commands use `!` by default. Commands are processed in TeamSpeak text
chat once the TS3 adapter is connected.

| Command                     | Alias                 | Description                                                                                        |
| --------------------------- | --------------------- | -------------------------------------------------------------------------------------------------- |
| `!play <URL or search>`     | `!p`                  | Resolve a YouTube video/playlist, SoundCloud or Spotify track, or search.                          |
| `!yt <search terms>`        | `!search`, `!youtube` | Add the first matching YouTube video to the queue.                                                 |
| `!pause`                    | -                     | Pause the current track.                                                                           |
| `!resume`                   | -                     | Resume the current track.                                                                          |
| `!skip`                     | `!s`                  | Skip the current track.                                                                            |
| `!stop`                     | -                     | Stop playback and disconnect the player from the current track.                                    |
| `!queue`                    | `!q`                  | Show the pending queue with per-track durations.                                                   |
| `!now-playing`              | `!np`, `!now`         | Show the current track, duration and requester.                                                    |
| `!volume <0-100>`           | `!vol`, `!v`          | Adjust the bot output volume (PCM gain before encoding; affects every listener).                   |
| `!remove <position>`        | `!rm`                 | Remove a one-based queue position.                                                                 |
| `!clear`                    | `!c`                  | Clear pending tracks.                                                                              |
| `!shuffle`                  | -                     | Shuffle the pending queue (the current track keeps playing).                                       |
| `!loop [off\|track\|queue]` | -                     | Repeat the current track (`track`) or the whole queue (`queue`); `!stop`/`!clear` disable looping. |
| `!test-tone`                | `!tone`               | Play a 3-second test tone (rate-limited).                                                          |
| `!help`                     | `!h`                  | Show the command summary.                                                                          |

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
- **Spotify:** tracks are resolved through the official Web API (client
  credentials flow, no user login) and the matching "artist title" is searched
  on YouTube for playback. Playlists and albums expand up to 20 tracks per
  `!play` (paged requests with 429 backoff, duplicates skipped).
- **Search text:** `!play` accepts free text and runs the same YouTube search
  as `!yt` (fuzzy term matching, channel credits, and a shortened retry when
  nothing is reliable).
- **Other sources:** local files and direct HTTPS audio URLs are rejected with
  a clear message.

No command may accept shell syntax. Rhapsod passes provider arguments directly
to child processes and never invokes a shell.
