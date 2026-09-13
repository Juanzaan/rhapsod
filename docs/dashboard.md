# Dashboard

[Español](dashboard.es.md)

Open the authenticated panel at `http://127.0.0.1:8080/`. For a remote host, use the SSH tunnel in [deployment](deployment.md). The dashboard combines playback, queue, sound controls, radio, server presence, channel chat and diagnostics.

## Playback and discovery

Search by title, artist or supported link. Select the next-track checkbox to insert ahead of the pending queue. A failed request keeps the search text so it can be retried. Previous, pause/resume, skip, stop and volume operate on the shared bot session.

Click the progress bar to seek. When focused, arrow keys move five seconds; Home and End move to the beginning and end. Live streams without a known duration cannot be sought. The rotating record indicates playback state and is decorative, not an audio spectrum or album cover.

The discovery card provides radio search and explicit autoplay on/off commands. Playlist and statistics buttons use the panel's bot command context; they do not impersonate a TeamSpeak user's personal library. Lyrics and history open in the output card.

## Background and motion

Choose Aurora, Sunset or Ocean from the background selector, or disable the background. These animated gradients are generated locally with CSS; there are no third-party images, GIF downloads or tracking requests.

The motion button pauses animation. Scene and motion preferences are stored in this browser, independently from bot configuration. System reduced-motion settings override animation, and hidden tabs pause movement. If browser storage is unavailable, the controls still work for the current page.

## Settings, commands and setup

The other panel pages use the same colors, typography and responsive cards. Settings are grouped by service, with read-only values identified and masked secrets preserved. The save bar remains available while scrolling. Commands can be searched by name, alias or description, including a leading `!`; required arguments remain visible. The setup wizard provides guided configuration and a link back to the console.

## Server and empty channels

The Server page displays channel and visible-user counts, channel/user search, expand/collapse controls and keyboard-accessible channel movement. Searching retains parent channels for context. Channels with a missing parent are shown at the root instead of disappearing.

Voice clients cannot run `channellist` (the server answers `command not found`), so Rhapsod discovers the tree by probing `channelinfo` per channel id. That query answers for every visible channel, including empty ones, which is why the panel shows the same rooms a normal client sees - password or rank requirements only gate joining, not listing. A full scan runs in the background at startup, on reconnect and every ten minutes; the minute resync only refreshes channels with visible users, and joins or moves resolve new channels immediately.

If the panel reports a limited view, the background scan has not completed yet or every probe failed; the tree then shows channels discovered from visible users only. No special server permission is needed for the scan. The refresh button re-reads the current snapshot. Deleted channels leave the tree on the next full scan; renamed channels update there as well.

## Verify the pages

Change the scene and reload to check persistence. Pause movement, then change the operating system's reduced-motion preference. Confirm the animation stays stopped. At narrow widths, cards stack into a single column and playback controls remain accessible.

Check the displayed channel, queue and connection state against TeamSpeak. The YouTube test is manual; an untested indicator is not a success result. Requests from the panel affect everyone listening to the bot.
