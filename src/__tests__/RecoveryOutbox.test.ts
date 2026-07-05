import { describe, expect, it } from "vitest";
import { buildRecoveryOutboxInput } from "@/app/api/cron/recovery-campaign/route";

const base = {
  clinicId: "clinic-1",
  conversationId: "conv-1",
  leadId: "lead-1",
  to: "5511999999999",
  text: "Oi! Posso te ajudar com os valores?",
};

describe("buildRecoveryOutboxInput", () => {
  it("categoriza como recovery e monta payload de automação", () => {
    const { outbound } = buildRecoveryOutboxInput({ ...base, now: new Date("2026-07-05T14:00:00Z") });
    expect(outbound.category).toBe("recovery");
    expect(outbound.channel).toBe("whatsapp");
    expect(outbound.deliveryKind).toBe("text");
    expect(outbound.payload).toMatchObject({
      version: 1,
      kind: "automation",
      to: base.to,
      text: base.text,
      leadId: base.leadId,
      conversationId: base.conversationId,
    });
  });

  it("é idempotente entre execuções do mesmo dia (dedupeKey e agentMessageId estáveis)", () => {
    const morning = buildRecoveryOutboxInput({ ...base, now: new Date("2026-07-05T09:00:00Z") });
    const evening = buildRecoveryOutboxInput({ ...base, now: new Date("2026-07-05T21:30:00Z") });
    expect(morning.dedupeKey).toBe(evening.dedupeKey);
    expect(morning.agentMessageId).toBe(evening.agentMessageId);
    // a linha pré-criada em messages usa agentMessageId como id → onConflictDoNothing
    expect(morning.outbound.payload.agentMessageId).toBe(morning.agentMessageId);
  });

  it("permite nova tentativa após virar o dia (recovery reincide após 7 dias)", () => {
    const day1 = buildRecoveryOutboxInput({ ...base, now: new Date("2026-07-05T14:00:00Z") });
    const day8 = buildRecoveryOutboxInput({ ...base, now: new Date("2026-07-13T14:00:00Z") });
    expect(day1.dedupeKey).not.toBe(day8.dedupeKey);
    expect(day1.agentMessageId).not.toBe(day8.agentMessageId);
  });

  it("gera UUID válido para o agentMessageId", () => {
    const { agentMessageId } = buildRecoveryOutboxInput({ ...base, now: new Date("2026-07-05T14:00:00Z") });
    expect(agentMessageId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});
