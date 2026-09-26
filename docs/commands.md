# Commands

[Español](commands.es.md)

Rhapsod commands use `!` by default. Commands are processed in TeamSpeak text
chat once the TS3 adapter is connected.

| Command                               | Alias                 | Description                                                                                                                          |
| ------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `!play <URL or search>`               | `!p`                  | Resolve a YouTube video/playlist, SoundCloud, Spotify, Apple Music or Amazon Music link, or search.                                  |
| `!playnext <URL or search>`           | `!pn`, `!next`        | Add a single track or search result at the front of the pending queue.                                                               |
| `!yt [n] <search terms>`              | `!search`, `!youtube` | Add a matching YouTube video; a leading number picks the n-th ranked result.                                                         |
| `!pause`                              | -                     | Pause the current track.                                                                                                             |
| `!resume`                             | -                     | Resume the current track.                                                                                                            |
| `!skip`                               | `!s`                  | Skip the current track (its requester, an admin, or a listener vote).                                                                |
| `!previous`                           | `!prev`               | Replay the last finished track.                                                                                                      |
| `!seek <seconds>`                     | -                     | Jump to a position in seconds within the current track.                                                                              |
| `!stop`                               | -                     | Stop playback and clear the queue (only when every track is yours or an autoplay pick, or as an admin).                              |
| `!queue [page]`                       | `!q`                  | Show 10 pending tracks per page with per-track durations.                                                                            |
| `!history`                            | `!hist`               | Show the 10 most recently started tracks (up to 20 are kept in memory).                                                              |
| `!now-playing`                        | `!np`, `!now`         | Show the current track, duration and requester (live radio shows the on-air title).                                                  |
| `!stats`                              | `!st`                 | Show uptime, tracks played since start, current track, queue length and volume/loop state.                                           |
| `!volume <0-100>`                     | `!vol`, `!v`          | Adjust the bot output volume (default `50`; persists in `state.json`).                                                               |
| `!move <from> <to>`                   | `!mv`                 | Move a pending track between one-based positions.                                                                                    |
| `!channel-move <channel>`             | `!ch`                 | Move the bot to a matching TeamSpeak channel (configured admins only).                                                               |
| `!diag`                               | -                     | Internal diagnostics (admins only).                                                                                                  |
| `!debug-server`                       | `!ds`                 | TeamSpeak server info (admins only).                                                                                                 |
| `!chart`                              | -                     | User telemetry chart (admins only).                                                                                                  |
| `!remove <n\|from-to>`                | `!rm`                 | Remove one position or an inclusive range (requesters may remove only their own tracks).                                             |
| `!clear`                              | `!c`                  | Clear pending tracks (only when every pending track is yours or an autoplay pick, or as an admin).                                   |
| `!shuffle`                            | -                     | Shuffle the pending queue (the current track keeps playing).                                                                         |
| `!loop [off\|track\|queue]`           | -                     | Repeat the current track (`track`) or the whole queue (`queue`); persists in `state.json`.                                           |
| `!lyrics`                             | `!ly`                 | Show the lyrics of the current track, found via LRCLIB (best-effort, no account).                                                    |
| `!playlist <subcommand>`              | `!pl`                 | Saved playlists: `save\|load\|list\|show\|delete\|add\|remove\|rename\|info`.                                                        |
| `!fav`                                | -                     | Save the current track to your favorites (max 50 per user).                                                                          |
| `!favs`                               | -                     | List your favorite tracks.                                                                                                           |
| `!unfav <n>`                          | -                     | Remove a favorite by its list position.                                                                                              |
| `!favplay <n>`                        | `!fp`                 | Add a favorite to the queue by its list position.                                                                                    |
| `!fuente [youtube\|soundcloud\|auto]` | -                     | Show or set your preferred search source for `!play` and `!yt`.                                                                      |
| `!radio <nombre, género o link>`      | `!rb`                 | Search the community radio directory (TuneIn fallback) and tune the top match; TuneIn page and tun.in links play directly.           |
| `!jump <posición>`                    | `!j`                  | Skip to a queue position (only its requesters or an admin).                                                                          |
| `!tops [n]`                           | `!top`                | Most played tracks (default 5, max 10).                                                                                              |
| `!mystats`                            | -                     | Your play counts, top artist and favorites.                                                                                          |
| `!autoplay [on\|off]`                 | -                     | Keep playing similar tracks when the queue empties (anyone may skip autoplay picks).                                                 |
| `!test-tone`                          | `!tone`               | Play a 3-second test tone (rate-limited).                                                                                            |
| `!help [1-4\|command]`                | `!h`                  | Show the category menu, one category per page with a pointer to the next, or one command with its aliases (`!help skip`, `!help s`). |

## Source behavior

- **Permissions:** most commands are open to everyone. `RHAPSOD_ADMIN_UIDS`
  grants admins the ability to remove tracks requested by other users with
  `!remove`, to skip anyone's current track with `!skip`, to stop or clear a
  queue that holds other users' tracks with `!stop`/`!clear`, and to use
  `!channel-move`; requesters can always remove their own tracks and skip
  their own current track. Tracks whose requester is no longer connected to
  the server are communal, like autoplay picks: anyone may skip, remove or
  clear them.
- **Vote skip:** with `RHAPSOD_VOTE_SKIP=true` (default `false`), `!skip` on
  someone else's track counts as a vote instead of being refused. The track
  is skipped when more than half of the people in the bot's channel voted:
  2 of 2, 2 of 3, 3 of 4. Only listeners in that channel can vote, a voter
  who leaves stops counting, and votes reset when the track changes. If the
  channel's client list cannot be read, the ownership rule applies.
- **Favorites:** `!fav` saves the current track per TS3 user id (up to 50),
  persisted to `data/user-preferences.json` (atomic write) and replayable
  with `!favplay <n>`.
- **Search source:** `!fuente soundcloud` routes free-text `!play` and `!yt`
  searches to SoundCloud; pasted links always use their own provider. Unset
  (or `auto`) means YouTube, and empty SoundCloud results fall back to
  YouTube instead of failing.
- **Autoplay:** `!autoplay on` keeps the music going after the queue drains
  by rotating three sources, four similar picks, three classics and three
  discoveries every ten tracks:
  - **Similar:** the YouTube mix of what just played, ranked for whoever
    has been requesting (artist affinity and title words from their recent
    sessions, energy continuity with the last track).
  - **Classics:** tracks the channel requested and let play before, rested
    for at least six hours; tracks skipped more often than finished never
    come back.
  - **Discoveries:** tracks the channel has never heard, from the YouTube
    mix of an artist the channel plays most.

  Autoplay's own picks do not count as requests: they never raise `!tops`
  or the taste profile, so autoplay does not reinforce itself. Skipping an
  autoplay pick counts against that track, and its source sits out the next
  two turns. When a source has nothing to offer, the next one fills in; with
  no history at all autoplay stays silent. Fetched mixes are reused for 30
  minutes. Songs heard on live radio join the same history once the station
  names them in its stream metadata, so the station rotation also feeds
  classics and `!tops`. Anyone may skip an autoplay pick. The flag persists
  in `data/state.json`.

- **Persistence:** `!volume` (default `50`) and `!loop` are saved to
  `data/state.json` (atomic write) and restored at startup; `!stop`/`!clear`
  reset looping and persist the change.
- **Queue editing:** `!playnext` promotes one resolved track ahead of every
  pending track; YouTube playlists must use `!play`. `!move` rejects missing
  source/destination positions. `!remove a-b` removes an inclusive range and
  caps ranges that extend beyond the queue end. `!jump <n>` plays the n-th
  queued track, dropping everything before it (same ownership rule as
  `!skip`/`!remove`). `!queue` ends with the remaining time, counting only
  tracks with a known duration.
- **YouTube:** Rhapsod uses a local `yt-dlp` executable to obtain metadata and
  a temporary audio URL immediately before playback. Search returns the
  ranked match (or the n-th pick); playlists add up to 100 tracks per `!play`
  (duplicates already in the queue are skipped) and report how many were
  added.
- **SoundCloud:** individual tracks first use SoundCloud's public web API with
  a dynamically discovered, cached client identifier. The identifier refreshes
  after authorization failures; yt-dlp and YouTube alternatives remain
  fallbacks. This unofficial API may change without notice. Sets (`/sets/`)
  use native SoundCloud expansion with SongLink alternatives where available;
  blocked/DRM tracks are never bypassed.
- **Spotify:** tracks are resolved through the official Web API (client
  credentials flow, no user login) and the matching "artist title" is searched
  on YouTube for playback. Playlists and albums expand up to 100 tracks per
  `!play` (paged requests with 429 backoff, duplicates skipped).
- **Apple Music:** song and album links resolve through the keyless iTunes
  lookup and play through a YouTube "artist title" search, like Spotify.
  Playlists expand up to 100 tracks the same way (lazy YouTube searches,
  like Spotify collections).
- **Amazon Music:** links are resolved through SongLink (Odesli), preferring
  the YouTube equivalent (playlists included) and falling back to
  SoundCloud. If nothing playable exists, `!play` says so instead of
  guessing.
- **Search text:** `!play` accepts free text and runs the same YouTube search
  as `!yt` (fuzzy term matching, channel credits, and a shortened retry when
  nothing is reliable).
- **Other sources:** local files are rejected with a clear message. Direct
  HTTPS audio URLs (files, HLS, icecast-style streams) play through
  `!play <audio-url>` via FFmpeg; `http:` is rejected, only `https:`.
  Icecast/shoutcast streams show the live on-air title in `!np` and the
  panel dashboard when the station sends ICY metadata. Discover stations
  by name, genre or country with `!radio` (community directory first,
  TuneIn fallback, top voted match wins). Pasted TuneIn page links and
  tun.in short links resolve to the station stream.

No command may accept shell syntax. Rhapsod passes provider arguments directly
to child processes and never invokes a shell.
