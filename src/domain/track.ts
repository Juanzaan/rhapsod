export type TrackId = string;

export interface Track {
  readonly alternativeProvider?: string;
  readonly durationSeconds?: number;
  readonly fallbackSources?: readonly string[];
  readonly id: TrackId;
  readonly requestedBy: string;
  readonly source: string;
  readonly title: string;
}
