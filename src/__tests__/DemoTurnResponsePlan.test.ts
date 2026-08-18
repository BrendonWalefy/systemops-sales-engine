import { describe, expect, it } from "vitest";
import { ConversationResponsePlanner } from "@/core/conversation/ConversationResponsePlanner";
import type { ComposedResponse, ComposerInput } from "@/core/intelligence/ResponseComposer";
import {
  DEMO_TURN_MAX_CHARACTERS,
  buildDemoTurnPlanInput,
} from "@/app/demo-turn-response";

// A Server Action `runAutonomousReceptionistTurn` alimenta a demo pública da
// landing. Não fala com lead por WhatsApp — fala com prospect na tela, o que é
// pior de um jeito diferente: um preço inventado ali é uma promessa comercial
// feita para quem está decidindo a compra.
function composerReturning(text: string) {
  return {
    async compose(): Promise<ComposedResponse> {
      return {
        text,
        parts: [{ type: "text", content: text }],
        mediaIds: [],
        model: "gpt-5.4-mini",
        promptVersion: "test",
        inputTokens: 10,
        outputTokens: 20,
      };
    },
  };
}

const composerInput = {
  actionResult: { type: "price_inquiry" },
  conversationHistory: [],
  clinic: {
    name: "Clínica Sorriso Premium",
    plan: "start",
    specialty: "odontologia",
    toneOfVoice: "Informal, acolhedor e consultivo.",
    playbook: "Oferecer sempre a avaliação gratuita como primeiro passo.",
    commercialPolicy: "Nunca informar valores por mensagem.",
  },
  leadName: "Marina",
  isFirstMessage: false,
} as unknown as ComposerInput;

describe("turno da demo pública", () => {
  it("não mostra ao prospect um preço que a clínica da demo não autorizou", async () => {
    const planner = new ConversationResponsePlanner(
      composerReturning("O clareamento sai por R$ 890 à vista!"),
    );

    const result = await planner.execute({
      composerInput,
      planInput: buildDemoTurnPlanInput({ maxCharacters: DEMO_TURN_MAX_CHARACTERS }),
    });

    expect(result.source).toBe("deterministic_fallback");
    expect(result.violations).toContain("unauthorized_price");
    expect(result.response.text).not.toContain("890");
  });

  it("preserva model e tokens do composer quando a resposta é válida", async () => {
    // A demo estima custo a partir desses campos; roteá-la pelo planner não
    // pode zerar a conta que aparece na tela de vendas.
    const planner = new ConversationResponsePlanner(
      composerReturning("Trabalhamos com avaliação gratuita para te passar o valor certo."),
    );

    const result = await planner.execute({
      composerInput,
      planInput: buildDemoTurnPlanInput({ maxCharacters: DEMO_TURN_MAX_CHARACTERS }),
    });

    expect(result.source).toBe("composer");
    expect(result.response.model).toBe("gpt-5.4-mini");
    expect(result.response.inputTokens).toBe(10);
    expect(result.response.outputTokens).toBe(20);
  });
});
