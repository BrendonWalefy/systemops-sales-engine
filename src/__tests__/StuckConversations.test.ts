import { describe, expect, it } from "vitest";
import {
  findStuckConversationAlerts,
  type StuckConversationCandidate,
} from "@/application/health/stuck-conversations";

const now = new Date("2026-06-16T12:00:00.000Z");
const THRESHOLD_MS = 3 * 60_000;

function candidate(
  overrides: Partial<StuckConversationCandidate>,
): StuckConversationCandidate {
  return {
    conversationId: "conv-1",
    clinicId: "clinic-1",
    leadName: "Maria",
    leadPhone: "5511999999999",
    latestMessageAuthor: "lead",
    latestMessageAt: new Date("2026-06-16T11:55:00.000Z"),
    latestMessageBody: "Quanto custa a consulta?",
    aiResumedAt: null,
    ...overrides,
  };
}

describe("findStuckConversationAlerts", () => {
  it("alerta quando a última mensagem é do lead e passou do threshold", () => {
    const alerts = findStuckConversationAlerts(
      [candidate({})],
      now,
      THRESHOLD_MS,
    );

    expect(alerts).toHaveLength(1);
    expect(alerts[0].conversationId).toBe("conv-1");
    expect(alerts[0].minutesStuck).toBe(5);
    expect(alerts[0].attentionReason).toBe(
      "Sem resposta automática há 5min — possível falha no processamento",
    );
    expect(alerts[0].leadDisplayName).toBe("Maria");
  });

  it("não alerta quando a IA já respondeu (última mensagem é do agent)", () => {
    const alerts = findStuckConversationAlerts(
      [
        candidate({
          latestMessageAuthor: "agent",
          latestMessageAt: new Date("2026-06-16T11:55:00.000Z"),
        }),
      ],
      now,
      THRESHOLD_MS,
    );

    expect(alerts).toHaveLength(0);
  });

  it("não alerta quando já houve handoff manual (última mensagem é do clinic_user)", () => {
    const alerts = findStuckConversationAlerts(
      [candidate({ latestMessageAuthor: "clinic_user" })],
      now,
      THRESHOLD_MS,
    );

    expect(alerts).toHaveLength(0);
  });

  it("não alerta quando ainda está dentro da janela normal de processamento", () => {
    const alerts = findStuckConversationAlerts(
      [
        candidate({
          latestMessageAt: new Date("2026-06-16T11:59:00.000Z"),
        }),
      ],
      now,
      THRESHOLD_MS,
    );

    expect(alerts).toHaveLength(0);
  });

  it("usa o telefone como nome de exibição quando o lead não tem nome", () => {
    const alerts = findStuckConversationAlerts(
      [candidate({ leadName: null })],
      now,
      THRESHOLD_MS,
    );

    expect(alerts[0].leadDisplayName).toBe("5511999999999");
    expect(alerts[0].pushTitle).toBe("5511999999999");
  });

  it("não alerta quando a mensagem do lead foi enviada antes da retomada da IA (pausa de takeover)", () => {
    // Cenário: operador atendeu, lead disse "OK obrigado" durante a pausa.
    // O TTL expirou → aiResumedAt = now-1h, mas a mensagem do lead chegou before resumption.
    const resumedAt = new Date("2026-06-16T11:58:00.000Z"); // IA retomou às 11:58
    const leadMsgAt = new Date("2026-06-16T11:50:00.000Z"); // lead respondeu às 11:50 (durante pausa)
    const alerts = findStuckConversationAlerts(
      [
        candidate({
          latestMessageAt: leadMsgAt,
          aiResumedAt: resumedAt,
        }),
      ],
      now,
      THRESHOLD_MS,
    );

    expect(alerts).toHaveLength(0);
  });

  it("alerta quando a mensagem do lead foi enviada DEPOIS da retomada da IA", () => {
    // Cenário: IA retomou, lead mandou nova mensagem, mas IA não respondeu → stuck real
    const resumedAt = new Date("2026-06-16T11:50:00.000Z"); // IA retomou às 11:50
    const leadMsgAt = new Date("2026-06-16T11:55:00.000Z"); // lead respondeu às 11:55 (pós-retomada)
    const alerts = findStuckConversationAlerts(
      [
        candidate({
          latestMessageAt: leadMsgAt,
          aiResumedAt: resumedAt,
        }),
      ],
      now,
      THRESHOLD_MS,
    );

    expect(alerts).toHaveLength(1);
    expect(alerts[0].minutesStuck).toBe(5);
  });
});
