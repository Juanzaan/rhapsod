export type TrackId = string;

export interface Track {
  readonly id: TrackId;
  readonly requestedBy: string;
  readonly source: string;
  readonly title: string;
}
