export interface VoiceConnectionOptions {
  readonly channelId?: string;
  readonly channelPassword?: string;
  readonly host: string;
  readonly nickname: string;
  readonly password?: string;
  readonly port: number;
}

export interface VoiceClient {
  connect(options: VoiceConnectionOptions): Promise<void>;
  disconnect(): Promise<void>;
  sendAudio(stream: NodeJS.ReadableStream): Promise<void>;
  stopAudio(): Promise<void>;
}
