import { describe, expect, it } from "vitest";
import { getObsoleteAutomationReason } from "@/application/jobs/send-message-job";
import type { OutboundSafetyContext } from "@/application/ports/outbound-safety-context-reader";

function context(overrides: {
  leadStatus?: string;
  aiPaused?: boolean;
  lastAuthor?: string;
}): OutboundSafetyContext {
  return {
    clinic: {
      id: "clinic-1",
      timezone: "America/Sao_Paulo",
      businessHours: null,
      outboundHourlyCap: 30,
      outboundDailyCap: 150,
    },
    lead: {
      id: "lead-1",
      phone: "5511999999999",
      whatsappLid: null,
      contactConsentRevokedAt: null,
      status: overrides.leadStatus ?? "lost",
    },
    conversation: { aiPaused: overrides.aiPaused ?? false },
    lastMessage: overrides.lastAuthor ? { author: overrides.lastAuthor } : null,
    agentMessage: { id: "msg-1" },
  } as unknown as OutboundSafetyContext;
}

describe("Campanha de reativação — quando fica obsoleta", () => {
  it("cancela quando o lead agendou entre a montagem e o envio", () => {
    // O cenário constrangedor: "vim te oferecer desconto" para quem acabou de marcar.
    expect(
      getObsoleteAutomationReason("campaign", context({ leadStatus: "appointment_scheduled" })),
    ).toBe("automation_obsolete");
  });

  it("cancela quando o lead já fechou", () => {
    expect(getObsoleteAutomationReason("campaign", context({ leadStatus: "won" }))).toBe(
      "automation_obsolete",
    );
  });

  it("cancela quando um humano assumiu a conversa", () => {
    expect(getObsoleteAutomationReason("campaign", context({ aiPaused: true }))).toBe(
      "automation_obsolete",
    );
  });

  it("NÃO cancela para lead 'lost' — é exatamente o público da reativação", () => {
    // A regra do follow-up cancela em 'lost'. Reusá-la aqui mataria quase toda
    // campanha de recuperação antes de sair.
    expect(getObsoleteAutomationReason("campaign", context({ leadStatus: "lost" }))).toBeNull();
    expect(getObsoleteAutomationReason("follow_up", context({ leadStatus: "lost" }))).toBe(
      "automation_obsolete",
    );
  });

  it("NÃO cancela quando a última mensagem é do lead — é o estado normal", () => {
    // O lead disse "tá caro" e a conversa parou ali. Para o follow-up isso
    // significa mensagem obsoleta; para a campanha, é a premissa.
    expect(
      getObsoleteAutomationReason("campaign", context({ lastAuthor: "lead" })),
    ).toBeNull();
    expect(
      getObsoleteAutomationReason("follow_up", context({ lastAuthor: "lead" })),
    ).toBe("automation_obsolete");
  });

  it("não interfere em outras categorias", () => {
    expect(getObsoleteAutomationReason("reply", context({ leadStatus: "won" }))).toBeNull();
    expect(getObsoleteAutomationReason("recovery", context({ leadStatus: "won" }))).toBeNull();
    expect(getObsoleteAutomationReason("reminder", context({ aiPaused: true }))).toBeNull();
  });
});
