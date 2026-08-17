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
  sendVoiceFrame(frame: Uint8Array): void;
}
