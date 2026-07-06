import { describe, expect, it } from "vitest";
import { RESPONSE_SCHEMA } from "@/core/intelligence/IntentClassifier";
import { evaluateOutboundSafetyGate } from "@/application/channel-safety/outbound-safety-gate";
import {
  resolveStopContactDecision,
  shouldTreatAsStopContact,
} from "@/application/channel-safety/stop-contact-policy";

// Contrato: o classificador só pode emitir stop_contact se ele estiver no enum
// do JSON schema strict. Sem isso, o opt-out nunca seria classificado e todo o
// resto (gravar consentimento, gate bloquear) ficaria inalcançável.
describe("stop_contact — contrato do classificador", () => {
  it("expõe stop_contact no enum do RESPONSE_SCHEMA", () => {
    const intents = RESPONSE_SCHEMA.properties.intent.enum as string[];
    expect(intents).toContain("stop_contact");
  });
});

describe("stop_contact — regra determinística", () => {
  it("reconhece pedidos explícitos de opt-out", () => {
    const positives = [
      "não quero mais receber mensagens",
      "para de me mandar mensagem",
      "me tira dessa lista",
      "não me chama mais aqui",
      "quero descadastrar",
      "cancela o recebimento",
    ];

    for (const messageText of positives) {
      expect(shouldTreatAsStopContact(messageText, "unclear")).toBe(true);
    }
  });

  it("bloqueia falsos positivos comuns", () => {
    const negatives = [
      "não quero esse horário",
      "não quero mais fazer o tratamento",
      "desisti do procedimento",
      "para",
      "tchau",
      "agora não",
    ];

    for (const messageText of negatives) {
      expect(shouldTreatAsStopContact(messageText, "stop_contact")).toBe(false);
    }
  });

  it("monta a decisão de consentimento e confirmação sem LLM", () => {
    const now = new Date("2026-07-06T12:00:00.000Z");
    const decision = resolveStopContactDecision({
      classifiedIntent: "unclear",
      messageText: "por favor me tira dessa lista",
      now,
    });

    expect(decision).toEqual({
      intent: "stop_contact",
      shouldRevokeConsent: true,
      revokedAt: now,
      source: "lead_message",
      confirmationText: "Entendido, não vou mais te enviar mensagens por aqui. Se precisar de algo no futuro, é só me chamar. 🙏",
      attentionReason: "Lead pediu para não receber mais mensagens (opt-out)",
    });
  });
});

// Fecha o laço: uma vez que o orchestrator grava contactConsentRevokedAt em
// resposta ao stop_contact, o Safety Gate cancela as automações. Aqui provamos
// o efeito do opt-out sobre cada categoria.
describe("stop_contact — efeito do opt-out no gate", () => {
  const clinic = {
    id: "clinic-1",
    timezone: "America/Sao_Paulo",
    businessHours: null,
    outboundHourlyCap: 100,
    outboundDailyCap: 1000,
  };
  const optedOutLead = {
    id: "lead-1",
    phone: "5511999999999",
    whatsappLid: null,
    contactConsentRevokedAt: new Date("2026-07-05T12:00:00Z"),
  };
  const now = new Date("2026-07-05T15:00:00Z");

  it("cancela follow_up/recovery/campaign de lead que deu opt-out", () => {
    for (const category of ["follow_up", "recovery", "campaign"] as const) {
      const decision = evaluateOutboundSafetyGate({
        category,
        clinic,
        lead: optedOutLead,
        sentLastHour: 0,
        sentToday: 0,
        now,
      });
      expect(decision).toEqual({ action: "cancel", reason: "consent_revoked" });
    }
  });

  it("não bloqueia reply nem reminder mesmo com opt-out", () => {
    for (const category of ["reply", "reminder", "operational"] as const) {
      const decision = evaluateOutboundSafetyGate({
        category,
        clinic,
        lead: optedOutLead,
        sentLastHour: 0,
        sentToday: 0,
        now,
      });
      expect(decision).toEqual({ action: "allow" });
    }
  });
});
