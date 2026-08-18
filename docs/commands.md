# Commands

Rhapsod commands use `!` by default. Commands are processed in TeamSpeak text
chat once the TS3 adapter is connected.

| Command                     | Alias         | Description                                                     |
| --------------------------- | ------------- | --------------------------------------------------------------- |
| `!play <media URL>`         | `!p`          | Resolve a YouTube video or SoundCloud track.                    |
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
  matching video; playlists and Spotify resolution are not connected yet.
- **SoundCloud:** individual tracks first use SoundCloud's public web API with
  a dynamically discovered, cached client identifier. The identifier refreshes
  after authorization failures; yt-dlp and YouTube alternatives remain
  fallbacks. This unofficial API may change without notice. Playlists are not
  expanded yet, and blocked/DRM tracks are never bypassed.
- **Other sources:** Spotify links, local files, direct HTTPS audio URLs, and
  YouTube search are planned but currently rejected by `!play`.

No command may accept shell syntax. Rhapsod passes provider arguments directly
to child processes and never invokes a shell.
