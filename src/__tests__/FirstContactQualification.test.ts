import { describe, it, expect } from "vitest";

// A3 — Qualificar antes do pitch.
//
// Comportamento ANTES: no 1º contato em modo concierge, uma mensagem que menciona um
// tratamento com pipeline de conteúdo despejava opener + explicação + imagem + vídeo
// tudo junto (o "pitch" antes de qualificar). A operadora humana (Gleice) faz o oposto:
// abre com uma pergunta de qualificação e só apresenta a explicação/mídia depois que o
// lead responde.
//
// Comportamento DEPOIS: no 1º contato concierge, envia SÓ o opener e posiciona o pipeline
// NO passo de conteúdo (deferido). Na próxima mensagem do lead, a continuação emite o
// conteúdo e avança. Este teste modela essa sequência (o padrão de teste "modelo puro"
// usado para o god-file ConversationOrchestrator, ver PipelineDeferredAdvance.test.ts).

type StepType = "content" | "qa";
interface Step { index: number; type: StepType }
interface PipelineState { stepIndex: number }

// Decisão do 1º contato: defere quando concierge + primeira msg + passo é "content".
function decideFirstContact(params: {
  isFirstMessage: boolean;
  experience: "concierge" | "menu_first";
  firstActive: Step;
}): { emitsContentNow: boolean; startsPipelineAt: number | null } {
  const defer =
    params.isFirstMessage &&
    params.experience === "concierge" &&
    params.firstActive.type === "content";
  if (defer) {
    return { emitsContentNow: false, startsPipelineAt: params.firstActive.index };
  }
  return { emitsContentNow: true, startsPipelineAt: params.firstActive.index };
}

// Continuação: com pipeline posicionado num passo "content", emite e avança.
function decideContinuation(params: {
  state: PipelineState;
  steps: Step[];
}): { emitsContent: boolean; nextStepIndex: number | null } {
  const current = params.steps[params.state.stepIndex];
  if (current?.type === "content") {
    const next = params.steps.find((s) => s.index > params.state.stepIndex) ?? null;
    return { emitsContent: true, nextStepIndex: next ? next.index : null };
  }
  return { emitsContent: false, nextStepIndex: null };
}

describe("A3 — qualificar antes do pitch (1º contato concierge)", () => {
  const steps: Step[] = [
    { index: 0, type: "content" }, // explicação + mídia das técnicas
    { index: 1, type: "qa" },
  ];

  it("1º contato concierge: NÃO emite conteúdo, posiciona pipeline no passo de conteúdo", () => {
    const decision = decideFirstContact({
      isFirstMessage: true,
      experience: "concierge",
      firstActive: steps[0],
    });
    expect(decision.emitsContentNow).toBe(false);
    expect(decision.startsPipelineAt).toBe(0);
  });

  it("próxima mensagem: continuação emite o conteúdo deferido e avança", () => {
    const cont = decideContinuation({ state: { stepIndex: 0 }, steps });
    expect(cont.emitsContent).toBe(true);
    expect(cont.nextStepIndex).toBe(1);
  });

  it("modo menu_first NÃO defere (comportamento inalterado)", () => {
    const decision = decideFirstContact({
      isFirstMessage: false,
      experience: "menu_first",
      firstActive: steps[0],
    });
    expect(decision.emitsContentNow).toBe(true);
  });

  it("passo inicial 'qa' (sem mídia) não é deferido — segue direto", () => {
    const decision = decideFirstContact({
      isFirstMessage: true,
      experience: "concierge",
      firstActive: { index: 0, type: "qa" },
    });
    expect(decision.emitsContentNow).toBe(true);
  });
});
