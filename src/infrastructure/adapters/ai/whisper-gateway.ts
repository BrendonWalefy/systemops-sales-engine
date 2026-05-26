import type { TranscriptionGateway } from "@/application/ports/transcription-gateway";

export class WhisperGateway implements TranscriptionGateway {
  async transcribe(audioBuffer: ArrayBuffer, mimeType: string): Promise<string> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY must be set");

    const form = new FormData();
    const ext = mimeType.split("/")[1]?.split(";")[0] ?? "ogg";
    form.append("file", new Blob([audioBuffer], { type: mimeType }), `audio.${ext}`);
    form.append("model", "whisper-1");
    form.append("language", "pt");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    let res: Response;
    try {
      res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Whisper transcription failed (${res.status}): ${err}`);
    }

    const data = (await res.json()) as { text?: string };
    if (!data.text?.trim()) throw new Error("Whisper returned empty transcription");

    return data.text.trim();
  }
}
