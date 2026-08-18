export type TrackId = string;

export interface Track {
  readonly alternativeProvider?: string;
  readonly id: TrackId;
  readonly requestedBy: string;
  readonly source: string;
  readonly title: string;
}
