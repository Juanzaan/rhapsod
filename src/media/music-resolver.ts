import type { YoutubeTrackMetadata } from "./youtube/yt-dlp.js";

export interface MusicResolver {
  readonly name: string;
  match(input: string): boolean;
  resolveTrack(input: string): Promise<YoutubeTrackMetadata>;
  resolveAudioUrl(input: string): Promise<string>;
  search?(query: string): Promise<YoutubeTrackMetadata>;
}
