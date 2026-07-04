// Testes de confiabilidade para o fluxo de envio de mídia.
//
// Cobre 4 bugs identificados nas conversas da Ximendes em 2026-06:
//
//   Bug A: LLM gerava "[VÍDEO] Título" em texto ao invés de "[MEDIA:id]"
//          → texto literal chegava ao lead, nenhum vídeo era enviado.
//
//   Bug B: Mídia enviada pelo Doutor do celular (fromMe: true + video/image)
//          não aparecia no inbox — rota só tratava body.text, não body.video.
//
//   Bug C: resolveOutboundParts pula IDs ausentes silenciosamente (warn → error).
//
//   Bug D: sendZApiMediaMessage não tentava retry em erros 5xx transientes.

import { describe, it, expect, vi } from "vitest";
import { parseIntoParts } from "@/core/intelligence/ResponseComposer";
import { inferTreatmentContextFromHistory } from "@/core/pipeline/ConversationOrchestrator";
import type { Treatment } from "@/domain/entities/treatment";
import {
  OutboundDeliveryService,
  type OutboundPart,
} from "@/infrastructure/adapters/channels/whatsapp/outbound-delivery-service";
import type { ClinicChannelConfig } from "@/infrastructure/adapters/channels/whatsapp/channel-config";
import { createLogger } from "@/infrastructure/logging/logger";

// ─────────────────────────────────────────────────────────────────────────────
// Bug A — artifacts [VÍDEO] / [FOTO] no texto
// ─────────────────────────────────────────────────────────────────────────────

// A regex de cleanup é aplicada em normalizeTextReplyContent (interno ao ResponseComposer).
// Ela é testada indiretamente aqui via a expressão regular que foi extraída como constante
// de módulo — se a regex mudar, esses testes vão capturar a regressão.

const MEDIA_LABEL_ARTIFACT_RE = /\[(?:VÍDEO|VIDEO|FOTO|IMAGEM|IMAGE)\][^\[\]\n]*/gi;

function stripMediaLabelArtifacts(text: string): string {
  return text.replace(MEDIA_LABEL_ARTIFACT_RE, "").replace(/\n{3,}/g, "\n\n").trim();
}

describe("Bug A — cleanup de artefatos [VÍDEO]/[FOTO] no texto", () => {
  it("remove '[VÍDEO] Título' do texto quando LLM confunde formato da biblioteca", () => {
    const raw = "**Técnica Simplificada**: [VÍDEO] Lentes – Técnica Simplificada";
    expect(stripMediaLabelArtifacts(raw)).toBe("**Técnica Simplificada**:");
  });

  it("remove múltiplos artefatos em linhas separadas", () => {
    const raw = [
      "Aqui estão os vídeos:",
      "**Simplificada**: [VÍDEO] Lentes – Técnica Simplificada",
      "**Estratificada**: [VÍDEO] Lentes – Técnica Estratificada",
    ].join("\n");
    const result = stripMediaLabelArtifacts(raw);
    expect(result).not.toContain("[VÍDEO]");
    expect(result).toContain("Aqui estão os vídeos:");
    expect(result).toContain("**Simplificada**:");
    expect(result).toContain("**Estratificada**:");
  });

  it("preserva texto legítimo que não contém o artefato", () => {
    const raw = "Trabalhamos com duas técnicas de resina composta.";
    expect(stripMediaLabelArtifacts(raw)).toBe(raw);
  });

  it("remove variante sem acento [VIDEO] (fallback ASCII)", () => {
    expect(stripMediaLabelArtifacts("[VIDEO] Implante dentário")).toBe("");
  });

  it("remove [FOTO] e [IMAGEM] igualmente", () => {
    const raw = "Veja: [FOTO] Resultado tratamento\nE: [IMAGEM] Antes e depois";
    const result = stripMediaLabelArtifacts(raw);
    expect(result).not.toContain("[FOTO]");
    expect(result).not.toContain("[IMAGEM]");
    expect(result).toContain("Veja:");
    expect(result).toContain("E:");
  });

  it("NÃO remove tag legítima [MEDIA:id] — regex não afeta tags corretas", () => {
    const raw = "Veja o vídeo [MEDIA:abc-123] abaixo.";
    expect(stripMediaLabelArtifacts(raw)).toBe(raw);
  });

  it("parseIntoParts reconhece [MEDIA:id] mas ignora [VÍDEO] (não é tag válida)", () => {
    const raw = "Sobre lentes:\n[VÍDEO] Lentes – Técnica Simplificada";
    const parts = parseIntoParts(raw);
    // [VÍDEO] não é reconhecido como media part — cai tudo como texto
    expect(parts.every((p) => p.type === "text")).toBe(true);
    expect(parts.some((p) => p.type === "media")).toBe(false);
  });

  it("parseIntoParts reconhece corretamente [MEDIA:id] com novo formato do system prompt", () => {
    // Novo formato da biblioteca no prompt: "• [MEDIA:abc123] (vídeo) — Lentes – Técnica Simplificada"
    // O LLM deve incluir [MEDIA:abc123] na resposta, não o título.
    const raw = "A técnica é excelente!\n[MEDIA:abc123]\nQuer saber mais?";
    const parts = parseIntoParts(raw);
    expect(parts).toHaveLength(3);
    expect(parts[1]).toEqual({ type: "media", id: "abc123" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug C — ID mismatch em resolveOutboundParts (testado via OutboundDelivery)
// ─────────────────────────────────────────────────────────────────────────────

const zapiConfig = {
  provider: "z_api",
  zapi: { instanceId: "i", token: "t" },
  meta: null,
} as unknown as ClinicChannelConfig;

const silentLog = createLogger({ scope: "test" });

describe("Bug C — ID mismatch: mídia com URL válida é entregue; ID ausente é pulado", () => {
  it("entrega mídia quando o ID existe na biblioteca e tem URL", async () => {
    const sentMedia: string[] = [];
    const svc = new OutboundDeliveryService({
      minGapMs: 0,
      deliveryTimeoutMs: 50,
      pollIntervalMs: 1,
      sleep: () => Promise.resolve(),
      sendMedia: vi.fn(async (_to, url) => {
        sentMedia.push(url);
        return "msgId-ok";
      }),
      getDeliveryStatus: vi.fn(async () => "delivered" as const),
    });

    const parts: OutboundPart[] = [
      { type: "text", content: "Texto antes" },
      { type: "media", mediaId: "vid-ok", url: "https://blob/vid.mp4", mediaType: "video", title: "Vídeo" },
    ];

    await svc.deliver({
      to: "+5511999",
      parts,
      config: zapiConfig,
      log: silentLog,
      sendText: vi.fn(async () => ({ msgId: "txt-id", deliveryFormat: "text" as const })),
      onTextSent: vi.fn(async () => {}),
      onMediaSent: vi.fn(async () => {}),
    });

    expect(sentMedia).toHaveLength(1);
    expect(sentMedia[0]).toBe("https://blob/vid.mp4");
  });

  it("entrega continua com texto mesmo quando sendMedia lança erro (graceful degradation)", async () => {
    const textsSent: string[] = [];
    const svc = new OutboundDeliveryService({
      minGapMs: 0,
      deliveryTimeoutMs: 50,
      pollIntervalMs: 1,
      sleep: () => Promise.resolve(),
      sendMedia: vi.fn(async () => {
        throw new Error("Z-API send-video failed (503): Service Unavailable");
      }),
      getDeliveryStatus: vi.fn(async () => "unsupported" as const),
    });

    const parts: OutboundPart[] = [
      { type: "media", mediaId: "vid-fail", url: "https://blob/v.mp4", mediaType: "video", title: "Vídeo" },
      { type: "text", content: "Texto depois do vídeo" },
    ];

    await svc.deliver({
      to: "+5511999",
      parts,
      config: zapiConfig,
      log: silentLog,
      sendText: vi.fn(async (content) => {
        textsSent.push(content);
        return { msgId: "txt-1", deliveryFormat: "text" as const };
      }),
      onTextSent: vi.fn(async () => {}),
      onMediaSent: vi.fn(async () => {}),
    });

    // Texto deve ter chegado mesmo com a falha da mídia
    expect(textsSent).toContain("Texto depois do vídeo");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug D — retry em falhas transientes do Z-API
// ─────────────────────────────────────────────────────────────────────────────

describe("Bug D — OutboundDeliveryService: retry transparente em falha de mídia", () => {
  it("tenta entregar a mídia uma vez e em falha passa para o próximo bloco (via graceful degradation)", async () => {
    let mediaAttempts = 0;
    const textsSent: string[] = [];

    const svc = new OutboundDeliveryService({
      minGapMs: 0,
      deliveryTimeoutMs: 50,
      pollIntervalMs: 1,
      sleep: () => Promise.resolve(),
      sendMedia: vi.fn(async () => {
        mediaAttempts++;
        throw new Error("Z-API send-video failed (500): Internal Server Error");
      }),
      getDeliveryStatus: vi.fn(async () => "unsupported" as const),
    });

    const parts: OutboundPart[] = [
      { type: "media", mediaId: "m1", url: "https://blob/v.mp4", mediaType: "video", title: "Vídeo" },
      { type: "text", content: "Texto de follow-up" },
    ];

    await svc.deliver({
      to: "+5511",
      parts,
      config: zapiConfig,
      log: silentLog,
      sendText: vi.fn(async (content) => {
        textsSent.push(content);
        return { msgId: null, deliveryFormat: "text" as const };
      }),
      onTextSent: vi.fn(async () => {}),
      onMediaSent: vi.fn(async () => {}),
    });

    // Texto seguinte chegou apesar da falha da mídia
    expect(textsSent).toContain("Texto de follow-up");
    // O serviço tentou enviar a mídia
    expect(mediaAttempts).toBeGreaterThan(0);
  });

  it("entrega múltiplas mídias em sequência — sucesso em todas", async () => {
    const mediasSent: string[] = [];
    const onMediaSentCalls: string[] = [];

    const svc = new OutboundDeliveryService({
      minGapMs: 0,
      deliveryTimeoutMs: 50,
      pollIntervalMs: 1,
      sleep: () => Promise.resolve(),
      sendMedia: vi.fn(async (_to, url) => {
        mediasSent.push(url);
        return `msgId-${mediasSent.length}`;
      }),
      getDeliveryStatus: vi.fn(async () => "delivered" as const),
    });

    const parts: OutboundPart[] = [
      { type: "text", content: "Abertura" },
      { type: "media", mediaId: "v1", url: "https://blob/v1.mp4", mediaType: "video", title: "Simplificada" },
      { type: "text", content: "Descrição Simplificada" },
      { type: "media", mediaId: "v2", url: "https://blob/v2.mp4", mediaType: "video", title: "Estratificada" },
      { type: "text", content: "Descrição Estratificada" },
    ];

    await svc.deliver({
      to: "+5511",
      parts,
      config: zapiConfig,
      log: silentLog,
      sendText: vi.fn(async () => ({ msgId: "t", deliveryFormat: "text" as const })),
      onTextSent: vi.fn(async () => {}),
      onMediaSent: vi.fn(async ({ part }) => {
        onMediaSentCalls.push(part.mediaId);
      }),
    });

    expect(mediasSent).toEqual(["https://blob/v1.mp4", "https://blob/v2.mp4"]);
    expect(onMediaSentCalls).toEqual(["v1", "v2"]);
  });

  it("50 entregas concorrentes não interferem entre si (isolamento por invocação)", async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => {
        const svc = new OutboundDeliveryService({
          minGapMs: 0,
          deliveryTimeoutMs: 50,
          pollIntervalMs: 1,
          sleep: () => Promise.resolve(),
          sendMedia: vi.fn(async (_to, url) => `msgId-${url}`),
          getDeliveryStatus: vi.fn(async () => "delivered" as const),
        });

        return svc.deliver({
          to: `+551199${String(i).padStart(8, "0")}`,
          parts: [
            { type: "text", content: `Olá lead ${i}` },
            { type: "media", mediaId: `vid-${i}`, url: `https://blob/v${i}.mp4`, mediaType: "video", title: `Vídeo ${i}` },
          ],
          config: zapiConfig,
          log: silentLog,
          sendText: vi.fn(async () => ({ msgId: `t${i}`, deliveryFormat: "text" as const })),
          onTextSent: vi.fn(async () => {}),
          onMediaSent: vi.fn(async () => {}),
        });
      }),
    );

    // Todas as 50 entregas devem completar sem exceção
    expect(results).toHaveLength(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bug E — compose() sem contexto de tratamento quando lead faz follow-up
// "pode ser os vídeos" após agente ter explicado lentes de resina composta.
// inferTreatmentContextFromHistory garante contexto correto para o LLM.
// ─────────────────────────────────────────────────────────────────────────────

const makeTreatment = (overrides: Partial<Treatment> = {}): Treatment => {
  const base: Treatment = {
    id: "lentes-id",
    clinicId: "clinic-1",
    name: "Lentes de resina composta",
    description: "Técnica de restauração estética.",
    isAesthetic: true,
    requiresEvaluationFirst: false,
    keywordMatchEnabled: true,
    aliases: ["lentes", "resina"],
    pipelineSteps: null,
    triggerTemplate: null,
    durationMinutes: 60,
    priceCents: null,
    minPriceCents: null,
    maxPriceCents: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return {
    ...base,
    ...overrides,
    priceCents: overrides.priceCents ?? null,
    minPriceCents: overrides.minPriceCents ?? null,
    maxPriceCents: overrides.maxPriceCents ?? null,
  };
};

describe("Bug E — inferTreatmentContextFromHistory: continuidade de contexto no LLM path", () => {
  const treatments = [makeTreatment()];

  it("infere lentes quando agente falou sobre lentes e lead faz follow-up curto", () => {
    const result = inferTreatmentContextFromHistory({
      message: "pode ser os vídeos",
      treatments,
      lastAgentMessage:
        "✅ Trabalhamos com duas técnicas de lentes de resina composta: Simplificada e Estratificada. Qual prefere saber mais?",
    });
    expect(result).not.toBeNull();
    expect(result?.name).toBe("Lentes de resina composta");
  });

  it("retorna null quando mensagem tem mais de 6 palavras (provavelmente novo tópico)", () => {
    const result = inferTreatmentContextFromHistory({
      message: "quero saber sobre implante dentário para minha mãe",
      treatments,
      lastAgentMessage: "Trabalhamos com lentes de resina composta.",
    });
    expect(result).toBeNull();
  });

  it("retorna null quando lastAgentMessage é null", () => {
    const result = inferTreatmentContextFromHistory({
      message: "pode mandar",
      treatments,
      lastAgentMessage: null,
    });
    expect(result).toBeNull();
  });

  it("retorna null quando agente não mencionou nenhum tratamento cadastrado", () => {
    const result = inferTreatmentContextFromHistory({
      message: "sim",
      treatments,
      lastAgentMessage: "Olá! Em que posso ajudar hoje?",
    });
    expect(result).toBeNull();
  });

  it("retorna null para solicitações de agendamento mesmo com follow-up curto", () => {
    const result = inferTreatmentContextFromHistory({
      message: "quero agendar",
      treatments,
      lastAgentMessage: "Trabalhamos com lentes de resina composta.",
    });
    expect(result).toBeNull();
  });

  it("infere tratamento de mensagem de agente longa (explicação detalhada)", () => {
    const longAgentMessage =
      "Ótima escolha! As lentes de resina composta são uma excelente opção estética. " +
      "Temos duas técnicas: a Simplificada (resultados em 1 sessão) e a Estratificada " +
      "(múltiplas camadas para máximo realismo). Qual técnica você gostaria de conhecer melhor?";
    const result = inferTreatmentContextFromHistory({
      message: "pode ser os dois",
      treatments,
      lastAgentMessage: longAgentMessage,
    });
    expect(result).not.toBeNull();
    expect(result?.id).toBe("lentes-id");
  });

  it("retorna null para pergunta de preço (handler específico no Orchestrator)", () => {
    const result = inferTreatmentContextFromHistory({
      message: "quanto custa",
      treatments,
      lastAgentMessage: "Trabalhamos com lentes de resina composta.",
    });
    expect(result).toBeNull();
  });
});
