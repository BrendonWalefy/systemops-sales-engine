import { describe, expect, it } from "vitest";
import { ConversationResponsePlanner } from "@/core/conversation/ConversationResponsePlanner";
import type { ComposedResponse, ComposerInput } from "@/core/intelligence/ResponseComposer";
import {
  FOLLOW_UP_MAX_CHARACTERS,
  buildFollowUpPlanInput,
} from "@/app/api/cron/follow-up-dispatcher/follow-up-response";

// O follow-up é outbound puro: o lead não perguntou nada e recebe o texto por
// WhatsApp. Até aqui a rota mandava o retorno cru do composer para a outbox.
function composerReturning(text: string) {
  return {
    async compose(): Promise<ComposedResponse> {
      return {
        text,
        parts: [{ type: "text", content: text }],
        mediaIds: [],
        model: "gpt-5.4-mini",
        promptVersion: "test",
        inputTokens: 0,
        outputTokens: 0,
      };
    },
  };
}

const composerInput = {
  actionResult: { type: "reengagement", lastAppointmentLabel: "seg, 07/07" },
  conversationHistory: [],
  clinic: {
    name: "Clínica X",
    plan: "start",
    specialty: "dental",
    toneOfVoice: null,
    playbook: null,
    commercialPolicy: null,
    receptionistName: "Ana",
  },
  leadName: "João",
  isFirstMessage: false,
} as unknown as ComposerInput;

describe("follow-up de reengajamento", () => {
  it("cai no fallback determinístico quando o composer inventa um preço", async () => {
    // O plano do follow-up não autoriza preço nenhum: reengajar não é negociar.
    const planner = new ConversationResponsePlanner(
      composerReturning("Oi, João! Voltamos com sua lente por R$ 1.200 só hoje."),
    );

    const result = await planner.execute({
      composerInput,
      planInput: buildFollowUpPlanInput({ maxCharacters: FOLLOW_UP_MAX_CHARACTERS }),
    });

    expect(result.source).toBe("deterministic_fallback");
    expect(result.violations).toContain("unauthorized_price");
    expect(result.response.text).not.toContain("1.200");
  });

  it("cai no fallback quando o composer promete resultado que a clínica não garantiu", async () => {
    const planner = new ConversationResponsePlanner(
      composerReturning("Oi, João! Volta que aqui os resultados são garantidos, sem risco."),
    );

    const result = await planner.execute({
      composerInput,
      planInput: buildFollowUpPlanInput({ maxCharacters: FOLLOW_UP_MAX_CHARACTERS }),
    });

    expect(result.source).toBe("deterministic_fallback");
    expect(result.violations).toContain("unsupported_guarantee");
  });

  it("entrega o texto do composer quando ele não afirma nada fora do plano", async () => {
    const planner = new ConversationResponsePlanner(
      composerReturning("Oi, João! Passando para saber se ainda posso te ajudar por aqui."),
    );

    const result = await planner.execute({
      composerInput,
      planInput: buildFollowUpPlanInput({ maxCharacters: FOLLOW_UP_MAX_CHARACTERS }),
    });

    expect(result.source).toBe("composer");
    expect(result.violations).toEqual([]);
  });

  it("o plano do follow-up não autoriza mídia nem política comercial", () => {
    const planInput = buildFollowUpPlanInput({ maxCharacters: FOLLOW_UP_MAX_CHARACTERS });

    expect(planInput.allowedMediaIds).toEqual([]);
    expect(planInput.commercialPolicy).toBeNull();
    expect(planInput.installmentTable).toBeNull();
  });
});
