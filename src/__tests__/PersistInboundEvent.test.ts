import { describe, expect, it, vi } from "vitest";
import { persistInboundEventAndEnqueue } from "@/application/whatsapp/persist-inbound-event";
import { DEFAULT_MESSAGE_DEBOUNCE_MS } from "@/core/pipeline/message-debounce";
import { buildZApiInboundEvent } from "@/infrastructure/adapters/channels/whatsapp/zapi-inbound-event";
import type { ZApiInboundPayload } from "@/infrastructure/adapters/channels/whatsapp/zapi-channel-adapter";

function payload(overrides: Partial<ZApiInboundPayload> = {}): ZApiInboundPayload {
  return {
    phone: "5511999999999",
    instanceId: "instance-1",
    messageId: "message-1",
    momment: 1_719_144_000_000,
    status: "RECEIVED_MESSAGE",
    chatName: "Lead",
    senderName: "Lead",
    isGroupMsg: false,
    isStatusReply: false,
    isEdit: false,
    fromMe: false,
    ...overrides,
  };
}

describe("persistInboundEventAndEnqueue", () => {
  it("prefere a persistência atômica quando o store durável a oferece", async () => {
    const recordInboundEventAndEnqueue = vi.fn().mockResolvedValue({
      inboundEventId: "event-atomic",
      eventWasNew: true,
      jobWasNew: true,
    });
    const recordInboundEvent = vi.fn();
    const enqueueJob = vi.fn();

    const result = await persistInboundEventAndEnqueue(
      buildZApiInboundEvent({ clinicId: "clinic-1", payload: payload() }),
      {
        inboundEventStore: {
          recordInboundEventAndEnqueue,
          recordInboundEvent,
        } as never,
        jobQueue: { enqueueJob } as never,
      },
    );

    expect(result).toEqual({
      inboundEventId: "event-atomic",
      eventWasNew: true,
      jobWasNew: true,
    });
    expect(recordInboundEvent).not.toHaveBeenCalled();
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it("enfileira message.process para um inbound novo agendado no fim da janela de rajada", async () => {
    // Move o sono da rajada para o schedule: run_at = recebimento + janela
    // padrão. A fila (que já ordena por run_at asc e filtra run_at <= now) faz
    // a espera; o worker não fica ocupado até a hora certa.
    const receivedAt = new Date("2026-06-23T12:00:00.000Z");
    const recordInboundEvent = vi.fn().mockResolvedValue({
      event: { id: "event-1", receivedAt },
      isNew: true,
    });
    const enqueueJob = vi.fn().mockResolvedValue({ isNew: true });

    const result = await persistInboundEventAndEnqueue(
      buildZApiInboundEvent({
        clinicId: "clinic-1",
        payload: payload({ text: { message: " Olá " }, momment: receivedAt.getTime() }),
      }),
      {
        inboundEventStore: { recordInboundEvent } as never,
        jobQueue: { enqueueJob } as never,
      },
    );

    expect(recordInboundEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "z_api",
        providerMessageId: "message-1",
        conversationKey: "5511999999999",
        normalizedText: "Olá",
        receivedAt,
      }),
    );
    expect(enqueueJob).toHaveBeenCalledWith({
      queue: "message.process",
      payload: { inboundEventId: "event-1" },
      dedupeKey: "inbound-event:event-1",
      runAt: new Date(receivedAt.getTime() + DEFAULT_MESSAGE_DEBOUNCE_MS),
    });
    expect(result).toEqual({ inboundEventId: "event-1", eventWasNew: true, jobWasNew: true });
  });

  it("agenda cada mensagem da rajada com um run_at próprio (não trava N workers em 15s cada)", async () => {
    // A propriedade central da mudança: se cinco mensagens chegam a cada 500ms,
    // seus jobs recebem cinco run_ats espaçados, e não um único "agora + 15s".
    // Quando o worker acorda em cada run_at, o resíduo da janela já é zero,
    // então nenhum dos cinco workers dorme os 15s completos.
    const t0 = new Date("2026-06-23T12:00:00.000Z").getTime();
    const enqueued: Array<{ dedupeKey?: string; runAt?: Date }> = [];
    const recordInboundEvent = vi.fn().mockImplementation(async (input: { providerMessageId: string; receivedAt?: Date }) => {
      const id = `event-${input.providerMessageId}`;
      return { event: { id, receivedAt: input.receivedAt ?? new Date() }, isNew: true };
    });
    const enqueueJob = vi.fn().mockImplementation(async (input: { dedupeKey?: string; runAt?: Date }) => {
      enqueued.push({ dedupeKey: input.dedupeKey, runAt: input.runAt });
      return { isNew: true };
    });

    for (let i = 0; i < 5; i += 1) {
      const receivedAt = new Date(t0 + i * 500);
      await persistInboundEventAndEnqueue(
        buildZApiInboundEvent({
          clinicId: "clinic-1",
          payload: payload({ messageId: `msg-${i}`, momment: receivedAt.getTime() }),
        }),
        {
          inboundEventStore: { recordInboundEvent } as never,
          jobQueue: { enqueueJob } as never,
        },
      );
    }

    const runAts = enqueued.map((entry) => entry.runAt?.toISOString());
    expect(runAts).toEqual([
      new Date(t0 + 0 + DEFAULT_MESSAGE_DEBOUNCE_MS).toISOString(),
      new Date(t0 + 500 + DEFAULT_MESSAGE_DEBOUNCE_MS).toISOString(),
      new Date(t0 + 1000 + DEFAULT_MESSAGE_DEBOUNCE_MS).toISOString(),
      new Date(t0 + 1500 + DEFAULT_MESSAGE_DEBOUNCE_MS).toISOString(),
      new Date(t0 + 2000 + DEFAULT_MESSAGE_DEBOUNCE_MS).toISOString(),
    ]);
    expect(new Set(runAts).size).toBe(5);
  });

  it("reenfileira duplicata por provider message id preservando o run_at agendado", async () => {
    // A janela do reenfileiramento ainda é medida a partir do recebimento
    // original — quem reprocessa não estende a espera.
    const receivedAt = new Date("2026-06-23T12:00:00.000Z");
    const recordInboundEvent = vi.fn().mockResolvedValue({
      event: { id: "event-1", receivedAt },
      isNew: false,
    });
    const enqueueJob = vi.fn().mockResolvedValue({ isNew: true });

    await persistInboundEventAndEnqueue(
      buildZApiInboundEvent({
        clinicId: "clinic-1",
        payload: payload({ momment: receivedAt.getTime() }),
      }),
      {
        inboundEventStore: { recordInboundEvent } as never,
        jobQueue: { enqueueJob } as never,
      },
    );

    expect(enqueueJob).toHaveBeenCalledOnce();
    expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({
      runAt: new Date(receivedAt.getTime() + DEFAULT_MESSAGE_DEBOUNCE_MS),
    }));
  });

  it("preserva payload sem texto para processamento posterior", () => {
    const event = buildZApiInboundEvent({
      clinicId: "clinic-1",
      payload: payload({ messageId: "message-without-text" }),
      now: new Date("2026-06-23T12:00:00.000Z"),
    });

    expect(event).toMatchObject({
      providerMessageId: "message-without-text",
      normalizedText: null,
      mediaType: null,
    });
  });

});
