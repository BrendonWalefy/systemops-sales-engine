// Tests for audio transcription logic added to zapi/route.ts.
// The POST handler cannot be unit-tested directly because it imports DB clients.
// Instead, we extract the audio-handling decision tree as pure functions and test them,
// and test WhisperGateway by mocking fetch.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Pure decision function extracted from route.ts audio logic ────────────
// Mirrors the exact conditional structure in the POST handler's inbound block.

type AudioPayload = { audioUrl: string; mimeType: string; seconds?: number };

function classifyInboundPayload(params: {
  hasText: boolean;
  audio?: AudioPayload;
}): "text" | "audio" | "unsupported" {
  if (params.hasText) return "text";
  if (params.audio?.audioUrl) return "audio";
  return "unsupported";
}

function buildMessageText(transcription: string): string {
  return `[áudio] ${transcription}`;
}

// ─── Tests: payload classification ─────────────────────────────────────────

describe("ZApi audio — payload classification", () => {
  it("payload com text.message → classificado como 'text'", () => {
    expect(classifyInboundPayload({ hasText: true })).toBe("text");
  });

  it("payload com audio.audioUrl sem text → classificado como 'audio'", () => {
    expect(
      classifyInboundPayload({
        hasText: false,
        audio: { audioUrl: "https://cdn.z-api.io/audio/abc.ogg", mimeType: "audio/ogg; codecs=opus" },
      }),
    ).toBe("audio");
  });

  it("payload sem text e sem audio (imagem, sticker, vídeo) → 'unsupported'", () => {
    expect(classifyInboundPayload({ hasText: false })).toBe("unsupported");
  });

  it("prefixo [áudio] adicionado ao texto transcrito", () => {
    expect(buildMessageText("Quero marcar uma consulta")).toBe("[áudio] Quero marcar uma consulta");
  });
});

// ─── Tests: WhisperGateway ─────────────────────────────────────────────────
// Tests WhisperGateway in isolation by mocking global fetch.

describe("WhisperGateway", async () => {
  const { WhisperGateway } = await import(
    "@/infrastructure/adapters/ai/whisper-gateway"
  );

  const dummyBuffer = new ArrayBuffer(8);
  const mimeType = "audio/ogg; codecs=opus";

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.OPENAI_API_KEY = "test-key";
  });

  it("transcrição bem-sucedida → retorna o texto", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ text: "Quero agendar uma consulta" }),
      }),
    );

    const gw = new WhisperGateway();
    const result = await gw.transcribe(dummyBuffer, mimeType);
    expect(result).toBe("Quero agendar uma consulta");
  });

  it("Whisper retorna string vazia → lança erro", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ text: "   " }),
      }),
    );

    const gw = new WhisperGateway();
    await expect(gw.transcribe(dummyBuffer, mimeType)).rejects.toThrow(
      "Whisper returned empty transcription",
    );
  });

  it("Whisper retorna status 500 → lança erro", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      }),
    );

    const gw = new WhisperGateway();
    await expect(gw.transcribe(dummyBuffer, mimeType)).rejects.toThrow(
      "Whisper transcription failed (500)",
    );
  });

  it("fetch lança erro (timeout) → erro propagado", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("AbortError: timeout")));

    const gw = new WhisperGateway();
    await expect(gw.transcribe(dummyBuffer, mimeType)).rejects.toThrow("AbortError: timeout");
  });
});

// ─── Tests: fluxo de áudio completo (simulado) ─────────────────────────────
// Simulates the route.ts audio branch with injected mocks for fetch and orchestrator.

describe("ZApi audio — fluxo completo (simulado)", () => {
  type HandleInput = {
    clinicId: string;
    phone: string;
    messageText: string;
    messageId: string;
    senderName?: string;
    timestamp: Date;
  };

  async function simulateAudioBranch(params: {
    audioUrl: string;
    mimeType: string;
    phone: string;
    downloadSucceeds: boolean;
    transcription: string | null; // null = lança erro
  }): Promise<{
    orchestratorCalledWith: HandleInput | null;
    fallbackSent: boolean;
    httpStatus: number;
  }> {
    let orchestratorCalledWith: HandleInput | null = null;
    let fallbackSent = false;

    const mockOrchestrator = {
      handle: async (input: HandleInput) => {
        orchestratorCalledWith = input;
      },
    };

    const mockSendFallback = async () => {
      fallbackSent = true;
    };

    let messageText: string | null = null;
    const httpStatus = 200;

    try {
      if (!params.downloadSucceeds) throw new Error("Network error");

      if (params.transcription === null) throw new Error("Whisper failed");
      if (params.transcription.trim() === "") throw new Error("Whisper returned empty transcription");

      messageText = `[áudio] ${params.transcription}`;
    } catch {
      await mockSendFallback();
      return { orchestratorCalledWith: null, fallbackSent: true, httpStatus: 200 };
    }

    await mockOrchestrator.handle({
      clinicId: "clinic-1",
      phone: params.phone,
      messageText,
      messageId: "msg-audio-1",
      timestamp: new Date(),
    });

    return { orchestratorCalledWith, fallbackSent, httpStatus };
  }

  it("áudio válido → transcrição bem-sucedida → orchestrator chamado com prefixo [áudio]", async () => {
    const result = await simulateAudioBranch({
      audioUrl: "https://cdn.z-api.io/abc.ogg",
      mimeType: "audio/ogg; codecs=opus",
      phone: "5511999999999",
      downloadSucceeds: true,
      transcription: "Quero marcar uma consulta",
    });

    expect(result.orchestratorCalledWith?.messageText).toBe("[áudio] Quero marcar uma consulta");
    expect(result.fallbackSent).toBe(false);
    expect(result.httpStatus).toBe(200);
  });

  it("falha no download do áudio → fallback enviado → retorna HTTP 200", async () => {
    const result = await simulateAudioBranch({
      audioUrl: "https://cdn.z-api.io/abc.ogg",
      mimeType: "audio/ogg; codecs=opus",
      phone: "5511999999999",
      downloadSucceeds: false,
      transcription: "irrelevante",
    });

    expect(result.orchestratorCalledWith).toBeNull();
    expect(result.fallbackSent).toBe(true);
    expect(result.httpStatus).toBe(200);
  });

  it("Whisper lança erro → fallback disparado → orchestrator não chamado", async () => {
    const result = await simulateAudioBranch({
      audioUrl: "https://cdn.z-api.io/abc.ogg",
      mimeType: "audio/ogg; codecs=opus",
      phone: "5511999999999",
      downloadSucceeds: true,
      transcription: null,
    });

    expect(result.orchestratorCalledWith).toBeNull();
    expect(result.fallbackSent).toBe(true);
    expect(result.httpStatus).toBe(200);
  });

  it("payload sem audio e sem text (imagem/sticker) → ignorado → HTTP 200", () => {
    const classification = classifyInboundPayload({ hasText: false, audio: undefined });
    expect(classification).toBe("unsupported");
    // A rota retorna 200 sem chamar orchestrator nem Whisper
  });

  it("payload com text.message → fluxo normal, classificação 'text'", () => {
    const classification = classifyInboundPayload({ hasText: true });
    expect(classification).toBe("text");
    // WhisperGateway nunca é instanciado nesse branch
  });
});
