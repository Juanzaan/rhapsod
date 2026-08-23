type MediaInput =
  | { readonly kind: "file"; readonly value: string }
  | { readonly kind: "soundcloud"; readonly value: string }
  | { readonly kind: "spotify"; readonly resource: SpotifyResource }
  | { readonly kind: "apple-music"; readonly value: string }
  | { readonly kind: "amazon-music"; readonly value: string }
  | { readonly kind: "url"; readonly value: string }
  | { readonly kind: "youtube"; readonly resource: YoutubeResource };

export type YoutubeResource =
  | { readonly id: string; readonly type: "playlist" }
  | {
      readonly id: string;
      readonly playlistId?: string;
      readonly type: "video";
    };

export type SpotifyResource =
  | { readonly id: string; readonly type: "album" }
  | { readonly id: string; readonly type: "playlist" }
  | { readonly id: string; readonly type: "track" };

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
]);
const SPOTIFY_HOST = "open.spotify.com";
const APPLE_MUSIC_HOSTS = new Set(["music.apple.com", "itunes.apple.com"]);
const SOUNDCLOUD_HOSTS = new Set(["soundcloud.com", "www.soundcloud.com"]);
const SOUNDCLOUD_SHORT_HOST = "on.soundcloud.com";

function isAmazonMusicHost(hostname: string): boolean {
  return (
    hostname === "music.amazon.com" || hostname.startsWith("music.amazon.")
  );
}

export function parseMediaInput(input: string): MediaInput {
  const value = input.trim();
  if (value.length === 0) {
    throw new Error("Media input cannot be empty");
  }

  if (value.startsWith("file:")) {
    const path = value.slice("file:".length).trim();
    if (path.length === 0) throw new Error("File input cannot be empty");
    return { kind: "file", value: path };
  }

  const url = parseUrl(value);
  if (!url) {
    return { kind: "file", value };
  }

  const youtubeResource = parseYoutubeResource(url);
  if (youtubeResource) return { kind: "youtube", resource: youtubeResource };

  const spotifyResource = parseSpotifyResource(url);
  if (spotifyResource) return { kind: "spotify", resource: spotifyResource };

  if (APPLE_MUSIC_HOSTS.has(url.hostname)) {
    return { kind: "apple-music", value: url.toString() };
  }

  if (isAmazonMusicHost(url.hostname)) {
    return { kind: "amazon-music", value: url.toString() };
  }

  if (
    (SOUNDCLOUD_HOSTS.has(url.hostname) &&
      url.pathname.split("/").filter(Boolean).length === 2) ||
    (url.hostname === SOUNDCLOUD_SHORT_HOST &&
      url.pathname.split("/").filter(Boolean).length === 1)
  ) {
    return { kind: "soundcloud", value: url.toString() };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("No reconozco ese tipo de link.");
  }

  return { kind: "url", value: url.toString() };
}

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function parseYoutubeResource(url: URL): YoutubeResource | undefined {
  if (url.hostname === "youtu.be") {
    const id = nonEmptySegment(url.pathname.slice(1));
    return id ? videoResource(id, url.searchParams.get("list")) : undefined;
  }
  if (!YOUTUBE_HOSTS.has(url.hostname)) return undefined;
  if (url.pathname === "/watch") {
    const id = nonEmptySegment(url.searchParams.get("v") ?? "");
    return id ? videoResource(id, url.searchParams.get("list")) : undefined;
  }
  if (url.pathname.startsWith("/shorts/")) {
    const id = nonEmptySegment(url.pathname.slice(8));
    return id ? videoResource(id, url.searchParams.get("list")) : undefined;
  }
  if (url.pathname === "/playlist") {
    const id = nonEmptySegment(url.searchParams.get("list") ?? "");
    return id ? { id, type: "playlist" } : undefined;
  }
  return undefined;
}

function parseSpotifyResource(url: URL): SpotifyResource | undefined {
  if (url.hostname !== SPOTIFY_HOST) return undefined;
  const segments = url.pathname.split("/").filter(Boolean);
  const offset = segments[0]?.startsWith("intl-") ? 1 : 0;
  const type = segments[offset];
  const id = segments[offset + 1];
  if (!type || !id || !["album", "playlist", "track"].includes(type))
    return undefined;
  if (!/^[A-Za-z0-9]+$/.test(id))
    throw new Error("Invalid Spotify resource identifier");
  return { id, type: type as SpotifyResource["type"] };
}

function videoResource(id: string, playlistId: string | null): YoutubeResource {
  const validPlaylistId = playlistId ? nonEmptySegment(playlistId) : undefined;
  return validPlaylistId
    ? { id, playlistId: validPlaylistId, type: "video" }
    : { id, type: "video" };
}

function nonEmptySegment(value: string): string | undefined {
  const segment = value.split(/[?&#/]/, 1)[0];
  return segment && /^[A-Za-z0-9_-]+$/.test(segment) ? segment : undefined;
}
