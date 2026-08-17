# Commands

Rhapsod commands use `!` by default. Commands are processed in TeamSpeak text
chat once the TS3 adapter is connected.

| Command                     | Alias         | Description                                                           |
| --------------------------- | ------------- | --------------------------------------------------------------------- |
| `!play <link or file>`      | `!p`          | Add a YouTube, Spotify, direct HTTPS URL, or local file to the queue. |
| `!pause`                    | -             | Pause the current track.                                              |
| `!resume`                   | -             | Resume the current track.                                             |
| `!skip`                     | `!s`          | Skip the current track.                                               |
| `!stop`                     | -             | Stop playback and disconnect the player from the current track.       |
| `!queue`                    | `!q`          | Show the pending queue.                                               |
| `!now-playing`              | `!np`, `!now` | Show the current track and requester.                                 |
| `!volume <0-100>`           | `!vol`, `!v`  | Set playback volume.                                                  |
| `!remove <position>`        | `!rm`         | Remove a one-based queue position.                                    |
| `!clear`                    | `!c`          | Clear pending tracks.                                                 |
| `!loop [off\|track\|queue]` | -             | Show or change the loop mode.                                         |
| `!help`                     | `!h`          | Show the command summary.                                             |

## Source behavior

- **YouTube:** Rhapsod uses a local `yt-dlp` executable to obtain metadata and
  a temporary audio URL immediately before playback.
- **Spotify:** Rhapsod can parse tracks, albums, and playlists, but the Spotify
  Web API does not provide raw audio. The initial implementation will use
  metadata only and clearly identify the chosen playback source.
- **Local files:** use `file: /absolute/or/relative/path.mp3` to avoid ambiguity.

No command may accept shell syntax. Rhapsod passes provider arguments directly
to child processes and never invokes a shell.
