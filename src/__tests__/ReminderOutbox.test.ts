import { describe, expect, it } from "vitest";
import { buildReminderOutboxInput } from "@/app/api/cron/appointment-reminder/route";
import type { TtsConfig } from "@/domain/entities/tts-config";

const ttsConfig = { provider: "openai_tts", voiceId: "alloy" } as unknown as TtsConfig;

const base = {
  clinicId: "clinic-1",
  conversationId: "conv-1",
  appointmentId: "appt-1",
  leadId: "lead-1",
  to: "5511999999999",
  text: "Passando para lembrar da sua consulta amanhã!",
  ttsConfig,
};

describe("buildReminderOutboxInput", () => {
  it("categoriza como reminder (isento do gate) e monta payload de automação", () => {
    const { outbound } = buildReminderOutboxInput({ ...base, useVoice: false });
    expect(outbound.category).toBe("reminder");
    expect(outbound.deliveryKind).toBe("text");
    expect(outbound.payload).toMatchObject({
      version: 1,
      kind: "automation",
      to: base.to,
      leadId: base.leadId,
      conversationId: base.conversationId,
      useVoice: false,
    });
  });

  it("usa deliveryKind audio quando useVoice", () => {
    const { outbound } = buildReminderOutboxInput({ ...base, useVoice: true });
    expect(outbound.deliveryKind).toBe("audio");
    expect(outbound.payload.useVoice).toBe(true);
  });

  it("é idempotente por consulta (dedupeKey e agentMessageId estáveis)", () => {
    const a = buildReminderOutboxInput({ ...base, useVoice: false });
    const b = buildReminderOutboxInput({ ...base, useVoice: true });
    expect(a.dedupeKey).toBe("reminder:appt-1");
    expect(a.agentMessageId).toBe(b.agentMessageId);
    expect(a.outbound.payload.agentMessageId).toBe(a.agentMessageId);
  });

  it("consultas diferentes geram dedupeKeys diferentes", () => {
    const a = buildReminderOutboxInput({ ...base, useVoice: false });
    const b = buildReminderOutboxInput({ ...base, appointmentId: "appt-2", useVoice: false });
    expect(a.dedupeKey).not.toBe(b.dedupeKey);
    expect(a.agentMessageId).not.toBe(b.agentMessageId);
  });
});
