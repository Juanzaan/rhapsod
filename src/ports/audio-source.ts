export interface AudioStream {
  readonly stream: NodeJS.ReadableStream;
  readonly title: string;
}

export interface AudioSource {
  resolve(input: string): Promise<AudioStream>;
}
