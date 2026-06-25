import type { TranscriptionGateway } from "@/application/ports/transcription-gateway";

export class ZApiAudioTranscriber {
  constructor(private readonly transcriptionGateway: TranscriptionGateway) {}

  async transcribe(audioUrl: string, mimeType: string): Promise<string> {
    const response = await fetch(audioUrl, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) {
      throw new Error(`Audio download failed (${response.status})`);
    }

    return this.transcriptionGateway.transcribe(await response.arrayBuffer(), mimeType);
  }
}
