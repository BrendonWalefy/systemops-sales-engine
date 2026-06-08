export type TtsRequest = {
  voice?: string;
  format?: "mp3" | "ogg" | "wav";
  speed?: number;
};

export type TtsGateway = {
  synthesize(text: string, options?: TtsRequest): Promise<ArrayBuffer>;
};
