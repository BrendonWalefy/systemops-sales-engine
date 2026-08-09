import { describe, expect, it } from "vitest";
import { ConversationResponsePlanner } from "@/core/conversation/ConversationResponsePlanner";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import type {
  ComposedResponse,
  ComposerInput,
} from "@/core/intelligence/ResponseComposer";

const validComposerInput: ComposerInput = {
  actionResult: { type: "general_question", clinicContext: "Dúvida autorizada" },
  conversationHistory: [],
  clinic: {
    name: "Clínica Teste",
    specialty: "odontologia",
    toneOfVoice: null,
    playbook: null,
    commercialPolicy: null,
  },
  timezone: new ClinicTimezone("America/Sao_Paulo"),
  isFirstMessage: false,
};

const composed = (text: string): ComposedResponse => ({
  text,
  parts: text ? [{ type: "text", content: text }] : [],
  mediaIds: [],
  model: "fake-composer",
  promptVersion: "test",
  inputTokens: 1,
  outputTokens: 1,
});

const input = () => ({
  composerInput: validComposerInput,
  planInput: {
    commercialPolicy: null,
    installmentTable: null,
    allowedMediaIds: [],
    expectedState: "idle",
    maxCharacters: 420,
  },
});

const clinicalInput = (reason: string) => ({
  ...input(),
  composerInput: {
    ...validComposerInput,
    actionResult: { type: "clinical_evaluation_required" as const, reason },
  },
});

describe("ConversationResponsePlanner", () => {
  it("mantém a resposta quando passa no plano", async () => {
    const response = composed("Resposta válida");
    const composer = { compose: async () => response };

    const result = await new ConversationResponsePlanner(composer).execute(input());

    expect(result).toEqual({
      plan: {
        version: "response-plan.v1",
        action: "general_question",
        allowedPriceCents: [],
        allowedScheduleFacts: [],
        allowedMediaIds: [],
        maxQuestions: 1,
        maxCharacters: 420,
        expectedState: "idle",
      },
      response,
      source: "composer",
      violations: [],
      requiresHandoff: false,
      fallbackReason: null,
    });
  });

  it("substitui resposta que inventa preço sem vazar o texto em diagnostics", async () => {
    const composer = { compose: async () => composed("Custa R$ 9.999,00") };

    const result = await new ConversationResponsePlanner(composer).execute(input());

    expect(result).toMatchObject({
      response: {
        text: "Quero te responder isso com precisão. Vou chamar nossa equipe para confirmar e continuar por aqui.",
        model: "deterministic-fallback",
        promptVersion: "response-fallback.v1",
      },
      source: "deterministic_fallback",
      violations: ["unauthorized_price"],
      requiresHandoff: true,
      fallbackReason: "response_plan_violation",
    });
    expect(JSON.stringify(result)).not.toContain("9.999");
  });

  it("usa fallback quando o composer lança sem vazar a mensagem do provider", async () => {
    const composer = {
      compose: async (): Promise<ComposedResponse> => {
        throw new Error("timeout-private-provider-details");
      },
    };

    const result = await new ConversationResponsePlanner(composer).execute(input());

    expect(result).toMatchObject({
      response: {
        text: "Quero te responder isso com precisão. Vou chamar nossa equipe para confirmar e continuar por aqui.",
        model: "deterministic-fallback",
      },
      source: "deterministic_fallback",
      violations: [],
      requiresHandoff: true,
      fallbackReason: "composer_error",
    });
    expect(JSON.stringify(result)).not.toContain("timeout-private-provider-details");
  });

  it("falha fechado antes da composição para razão clínica não canônica", async () => {
    const rawReason = "paciente sinalizado pela auditoria interna";
    const composer = { compose: async () => composed(`Detalhes: ${rawReason}`) };

    const result = await new ConversationResponsePlanner(composer).execute(
      clinicalInput(rawReason),
    );

    expect(result).toMatchObject({
      response: {
        text: "Quero te responder isso com precisão. Vou chamar nossa equipe para confirmar e continuar por aqui.",
        model: "deterministic-fallback",
      },
      source: "deterministic_fallback",
      violations: [],
      requiresHandoff: true,
      fallbackReason: "response_plan_violation",
    });
    expect(JSON.stringify(result)).not.toContain(rawReason);
  });

  it("mantém o caminho normal para razão clínica canônica", async () => {
    const response = composed("Caso clínico encaminhado para avaliação.");
    const composer = { compose: async () => response };

    const result = await new ConversationResponsePlanner(composer).execute(
      clinicalInput("dente fraturado"),
    );

    expect(result.source).toBe("composer");
    expect(result.response).toBe(response);
    expect(result.fallbackReason).toBeNull();
  });
});
