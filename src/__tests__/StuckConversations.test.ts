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
});
