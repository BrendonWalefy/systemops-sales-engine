export type TranscriptionGateway = {
  transcribe(audioBuffer: ArrayBuffer, mimeType: string): Promise<string>;
};
