import { describe, expect, it, vi } from "vitest";
import {
  BufferedDatabaseDecisionTraceSink,
  sanitizeDecisionTraceRecord,
} from "@/infrastructure/observability/runtime-decision-trace";
import type { DecisionTraceBatchStore } from "@/infrastructure/repositories/drizzle-decision-trace-store";
import type { DecisionTraceMetadata } from "@/core/observability/DecisionTrace";

function traceMetadata(metadata: DecisionTraceMetadata): DecisionTraceMetadata {
  return metadata;
}

describe("runtime DecisionTrace", () => {
  it("agrega eventos e persiste somente no fechamento do processamento", async () => {
    const append = vi.fn().mockResolvedValue(undefined);
    const store: DecisionTraceBatchStore = { append };
    const now = new Date("2026-07-26T12:00:00.000Z");
    const sink = new BufferedDatabaseDecisionTraceSink(store, () => now);

    await sink.record({
      turnId: "turn-1",
      stage: "ingress.received",
      occurredAt: "2026-07-26T11:59:58.000Z",
      clinicId: "clinic-1",
      metadata: { provider: "z_api" },
    });
    await sink.record({
      turnId: "turn-1",
      stage: "intent.resolved",
      occurredAt: "2026-07-26T11:59:59.000Z",
      clinicId: "clinic-1",
      conversationId: "conversation-1",
      metadata: { finalIntent: "price_inquiry" },
    });
    expect(append).not.toHaveBeenCalled();

    await sink.record({
      turnId: "turn-1",
      stage: "orchestrator.completed",
      occurredAt: now.toISOString(),
      clinicId: "clinic-1",
      conversationId: "conversation-1",
      metadata: { replied: true },
    });

    expect(append).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith(expect.objectContaining({
      turnId: "turn-1",
      clinicId: "clinic-1",
      conversationId: "conversation-1",
      events: expect.arrayContaining([
        expect.objectContaining({ stage: "ingress.received" }),
        expect.objectContaining({ stage: "intent.resolved" }),
        expect.objectContaining({ stage: "orchestrator.completed" }),
      ]),
      expiresAt: new Date("2026-08-25T12:00:00.000Z"),
    }));
  });

  it("acrescenta a fase de entrega como um segundo lote do mesmo turno", async () => {
    const append = vi.fn().mockResolvedValue(undefined);
    const sink = new BufferedDatabaseDecisionTraceSink({ append });

    await sink.record({
      turnId: "turn-1",
      stage: "delivery.started",
      occurredAt: "2026-07-26T12:00:01.000Z",
      clinicId: "clinic-1",
      conversationId: "conversation-1",
    });
    await sink.record({
      turnId: "turn-1",
      stage: "delivery.sent",
      occurredAt: "2026-07-26T12:00:02.000Z",
      clinicId: "clinic-1",
      conversationId: "conversation-1",
      metadata: { providerAccepted: true },
    });

    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0]?.[0].events).toHaveLength(2);
  });

  it("remove qualquer metadado não autorizado antes de persistir", () => {
    expect(sanitizeDecisionTraceRecord({
      turnId: "turn-1",
      stage: "intent.resolved",
      occurredAt: "2026-07-26T12:00:00.000Z",
      clinicId: "clinic-1",
      metadata: traceMetadata({
        finalIntent: "location",
        phone: "5511999999999",
        messageText: "conteúdo privado",
        prompt: "prompt privado",
      }),
    })).toEqual({
      turnId: "turn-1",
      stage: "intent.resolved",
      occurredAt: "2026-07-26T12:00:00.000Z",
      clinicId: "clinic-1",
      metadata: { finalIntent: "location" },
    });
  });

  it.each([
    {
      stage: "response.plan_built" as const,
      metadata: traceMetadata({
        action: "price_inquiry",
        planVersion: "response-plan-v1",
        allowedPriceCount: 2,
        allowedScheduleFactCount: 1,
        allowedMediaCount: 0,
        maxCharacters: 600,
        expectedState: "none",
        responseText: "conteúdo privado",
      }),
      expected: {
        action: "price_inquiry",
        planVersion: "response-plan-v1",
        allowedPriceCount: 2,
        allowedScheduleFactCount: 1,
        allowedMediaCount: 0,
        maxCharacters: 600,
        expectedState: "none",
      },
    },
    {
      stage: "response.validated" as const,
      metadata: traceMetadata({
        action: "price_inquiry",
        valid: false,
        violationCount: 2,
        requiresHandoff: true,
        policy: "política privada",
      }),
      expected: {
        action: "price_inquiry",
        valid: false,
        violationCount: 2,
        requiresHandoff: true,
      },
    },
    {
      stage: "response.fallback_applied" as const,
      metadata: traceMetadata({
        action: "price_inquiry",
        fallbackReason: "validation_failed",
        requiresHandoff: true,
        mediaId: "asset-secreto",
        url: "https://private.example/patient",
      }),
      expected: {
        action: "price_inquiry",
        fallbackReason: "validation_failed",
        requiresHandoff: true,
      },
    },
  ])("preserva o contrato seguro de $stage na sanitização de produção", ({
    stage,
    metadata,
    expected,
  }) => {
    expect(sanitizeDecisionTraceRecord({
      turnId: "turn-response",
      stage,
      occurredAt: "2026-08-09T00:00:00.000Z",
      metadata,
    })).toEqual({
      turnId: "turn-response",
      stage,
      occurredAt: "2026-08-09T00:00:00.000Z",
      metadata: expected,
    });
  });

  it("preserva o encerramento quando o turno atinge o limite de eventos", async () => {
    const append = vi.fn().mockResolvedValue(undefined);
    const sink = new BufferedDatabaseDecisionTraceSink({ append });

    for (let index = 0; index < 40; index += 1) {
      await sink.record({
        turnId: "turn-noisy",
        stage: "intent.resolved",
        occurredAt: new Date(2026, 6, 26, 12, 0, index).toISOString(),
        clinicId: "clinic-1",
        metadata: { attempt: index },
      });
    }
    await sink.record({
      turnId: "turn-noisy",
      stage: "turn.failed",
      occurredAt: "2026-07-26T12:01:00.000Z",
      clinicId: "clinic-1",
      metadata: { phase: "delivery" },
    });

    expect(append).toHaveBeenCalledTimes(1);
    const events = append.mock.calls[0]?.[0].events;
    expect(events).toHaveLength(40);
    expect(events.at(-1)).toEqual(expect.objectContaining({
      stage: "turn.failed",
    }));
  });
});
