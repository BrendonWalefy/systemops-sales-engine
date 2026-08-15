import { describe, expect, it } from "vitest";
import { ConversationResponsePlanner } from "@/core/conversation/ConversationResponsePlanner";
import type { ComposedResponse, ComposerInput } from "@/core/intelligence/ResponseComposer";
import {
  RECOVERY_MAX_CHARACTERS,
  buildRecoveryComposerInput,
  buildRecoveryPlanInput,
} from "@/app/api/cron/recovery-campaign/recovery-response";

// A campanha de recuperação é o caminho mais exposto do sistema: cron agendado
// duas vezes por dia no vercel.json, sem humano nenhum entre a geração e o
// WhatsApp do lead. O gerador tem prompt próprio, com regras em prosa ("não
// prometa agendamento", "não liste horários"). Prosa não é fronteira — o plano é.
function generatorReturning(text: string) {
  return {
    async compose(): Promise<ComposedResponse> {
      return {
        text,
        parts: [{ type: "text", content: text }],
        mediaIds: [],
        model: "gpt-4o-mini",
        promptVersion: "recovery-campaign.v1",
        inputTokens: 800,
        outputTokens: 60,
      };
    },
  };
}

const composerInput: ComposerInput = buildRecoveryComposerInput({
  treatmentNames: ["Lentes de resina", "Clareamento"],
  clinic: {
    name: "Clínica X",
    plan: "start",
    specialty: "odontologia",
    toneOfVoice: null,
    playbook: null,
    commercialPolicy: null,
    receptionistName: "Ana",
  } as ComposerInput["clinic"],
  leadName: "João",
  timezone: "America/Sao_Paulo",
});

const planInput = buildRecoveryPlanInput({
  maxCharacters: RECOVERY_MAX_CHARACTERS,
  authorizedServices: [
    { name: "Lentes de resina", aliases: ["lente de resina"], priceCents: null },
    { name: "Clareamento", aliases: [], priceCents: null },
  ],
});

describe("campanha de recuperação", () => {
  it("não deixa preço inventado chegar ao lead", async () => {
    const planner = new ConversationResponsePlanner(
      generatorReturning("Oi, João! Suas lentes de resina saem por R$ 2.000 esta semana."),
    );

    const result = await planner.execute({ composerInput, planInput });

    expect(result.source).toBe("deterministic_fallback");
    expect(result.violations).toContain("unauthorized_price");
    expect(result.response.text).not.toContain("2.000");
  });

  it("não deixa horário inventado chegar ao lead", async () => {
    // A regra "NÃO liste datas ou horários disponíveis" vivia só no prompt. O
    // plano de recuperação não autoriza fato de agenda nenhum, então agora ela
    // é verificada e não pedida.
    const planner = new ConversationResponsePlanner(
      generatorReturning("Oi, João! Consigo te encaixar na terça-feira às 14:00, pode ser?"),
    );

    const result = await planner.execute({ composerInput, planInput });

    expect(result.source).toBe("deterministic_fallback");
    expect(result.violations).toContain("unauthorized_schedule_fact");
    expect(result.response.text).not.toContain("14:00");
  });

  it("não deixa garantia de resultado chegar ao lead", async () => {
    const planner = new ConversationResponsePlanner(
      generatorReturning("Oi, João! Volta que aqui trabalhamos com resultados garantidos."),
    );

    const result = await planner.execute({ composerInput, planInput });

    expect(result.source).toBe("deterministic_fallback");
    expect(result.violations).toContain("unsupported_guarantee");
  });

  it("entrega o texto do gerador quando ele fica dentro do plano", async () => {
    const planner = new ConversationResponsePlanner(
      generatorReturning(
        "Oi, João! Vi seu interesse em clareamento e posso te ajudar com os valores por aqui.",
      ),
    );

    const result = await planner.execute({ composerInput, planInput });

    expect(result.source).toBe("composer");
    expect(result.violations).toEqual([]);
    expect(result.response.text).toContain("clareamento");
  });

  it("o fallback é uma retomada real, não o pedido de socorro genérico", async () => {
    // Recovery é outbound: o lead não perguntou nada. Cair na cópia
    // "vou chamar nossa equipe" mandaria um handoff sem pergunta pendente.
    const planner = new ConversationResponsePlanner(
      generatorReturning("Sai por R$ 2.000."),
    );

    const result = await planner.execute({ composerInput, planInput });

    expect(result.response.text).not.toContain("chamar nossa equipe");
    expect(result.requiresHandoff).toBe(false);
  });

  it("não deixa tratamento inventado chegar ao lead", async () => {
    // A regra vivia na prosa do prompt: "use APENAS os nomes exatos dos
    // procedimentos — nunca 'lentes de contato dental'". Agora é verificada.
    const planner = new ConversationResponsePlanner(
      generatorReturning("Oi, João! Temos lentes de contato dental prontas para você."),
    );

    const result = await planner.execute({ composerInput, planInput });

    expect(result.source).toBe("deterministic_fallback");
    expect(result.violations).toContain("unauthorized_service");
    expect(result.response.text).not.toContain("contato dental");
    // O fallback continua sendo uma retomada, não um pedido de socorro.
    expect(result.requiresHandoff).toBe(false);
  });

  it("o plano de recuperação não autoriza preço, agenda nem mídia", () => {
    expect(planInput.commercialPolicy).toBeNull();
    expect(planInput.installmentTable).toBeNull();
    expect(planInput.allowedMediaIds).toEqual([]);
    expect(composerInput.actionResult).toEqual({
      type: "conversation_recovery",
      treatmentNames: ["Lentes de resina", "Clareamento"],
    });
  });
});
