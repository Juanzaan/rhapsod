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

## Verify

Change the scene and reload to check persistence. Pause movement, then change the operating system's reduced-motion preference. Confirm the animation stays stopped. At narrow widths, cards stack into a single column and playback controls remain accessible.

Check the displayed channel, queue and connection state against TeamSpeak. The YouTube test is manual; an untested indicator is not a success result. Requests from the panel affect everyone listening to the bot.
