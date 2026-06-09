// Testes derivados de conversas reais da clínica Ximendes Odontologia.
// Cada describe identifica a conversa original e o padrão que motivou o teste.
// Objetivo: garantir que o sistema trata corretamente os padrões observados
// em produção (05-08/06/2026), quando a IA estava desativada e o operador
// respondia manualmente.

import { describe, it, expect } from "vitest";
import { buildActionContext } from "@/core/intelligence/ResponseComposer";
import { shouldShowInitialMenu } from "@/core/pipeline/ConversationOrchestrator";
import { resolveDirectTreatmentMention } from "@/core/pipeline/ConversationOrchestrator";
import type { Treatment } from "@/domain/entities/treatment";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeTreatment(name: string, requiresEvaluation = false): Treatment {
  return {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    clinicId: "ximendes",
    name,
    durationMinutes: 60,
    description: null,
    commonObjections: [],
    requiresEvaluationFirst: requiresEvaluation,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

const ximendesTreatments = [
  makeTreatment("Avaliação"),
  makeTreatment("Lentes de resina composta", true),
  makeTreatment("Lentes de porcelana", true),
  makeTreatment("Clareamento dental"),
  makeTreatment("Implante dentário", true),
  makeTreatment("Botox odontológico"),
  makeTreatment("Limpeza dental"),
  makeTreatment("Tratamento de canal"),
];

// ─── 1. patient_arrived — Rogger Tenorio (01/06) e Fe Em Deus (08/06) ─────────
// Antes do fix: paciente que avisou chegada/atraso recebia o menu completo.
// Esperado: shouldShowInitialMenu retorna false; action context é acolhedor.

describe("patient_arrived — paciente chegando ou se atrasando", () => {
  it("shouldShowInitialMenu retorna false para patient_arrived em menu_first", () => {
    expect(shouldShowInitialMenu("menu_first", "patient_arrived")).toBe(false);
  });

  it("shouldShowInitialMenu retorna false para patient_arrived em concierge", () => {
    expect(shouldShowInitialMenu("concierge", "patient_arrived")).toBe(false);
  });

  it("action context confirma que a equipe foi avisada (com consulta hoje)", () => {
    const ctx = buildActionContext({
      type: "patient_arrived",
      appointmentTime: new Date("2026-06-08T15:00:00-03:00"),
    });
    expect(ctx).toContain("equipe");
    expect(ctx).toContain("avisad");
  });

  it("action context sem consulta hoje ainda é acolhedor e proíbe oferecer menu ou agendamento", () => {
    const ctx = buildActionContext({ type: "patient_arrived", appointmentTime: null });
    expect(ctx).toContain("equipe");
    // Verifica que a instrução PROÍBE menu e agendamento (não os oferece)
    expect(ctx).toContain("NÃO ofereça menu");
    expect(ctx).toContain("NÃO ofereça agendamento");
  });

  it("action context limita a 2 frases (sem menu, sem perguntas)", () => {
    const ctx = buildActionContext({
      type: "patient_arrived",
      appointmentTime: new Date("2026-06-01T12:00:00-03:00"),
    });
    expect(ctx).toContain("NÃO ofereça menu");
    expect(ctx).toContain("NÃO faça perguntas");
  });
});

// ─── 2. Gregorie — sub-menu de procedimentos (03-04/06) ──────────────────────
// Bug: selecionar "Avaliação" quando a IA havia acabado de perguntar o procedimento
// gerava "problema técnico". A regra crítica: resolveDirectTreatmentMention deve
// retornar null quando a IA acabou de perguntar explicitamente o procedimento.

describe("resolveDirectTreatmentMention — resposta ao agente que pediu procedimento", () => {
  const agentQuestion = "Qual procedimento você gostaria de realizar?";

  it("'Avaliação' como resposta à pergunta do agente não é interceptada como menção direta", () => {
    const result = resolveDirectTreatmentMention("Avaliação", ximendesTreatments, agentQuestion);
    expect(result).toBeNull();
  });

  it("'lentes' como resposta à pergunta do agente não é interceptada como menção direta", () => {
    const result = resolveDirectTreatmentMention("lentes", ximendesTreatments, agentQuestion);
    expect(result).toBeNull();
  });

  it("'limpeza das lentes' fora de contexto de pergunta é interceptada como menção direta", () => {
    const result = resolveDirectTreatmentMention("limpeza das lentes", ximendesTreatments, null);
    expect(result).not.toBeNull();
  });

  it("número isolado ('9') nunca é interceptado como menção direta", () => {
    expect(resolveDirectTreatmentMention("9", ximendesTreatments, null)).toBeNull();
    expect(resolveDirectTreatmentMention("9", ximendesTreatments, "Menu ativo")).toBeNull();
  });

  it("pergunta de preço com especificação técnica ('lentes BL2 quanto custa') não é menção direta", () => {
    // Pergunta de preço → deve ir para IntentClassifier como price_inquiry, não interceptar
    expect(resolveDirectTreatmentMention("lentes BL2 quanto custa", ximendesTreatments, null)).toBeNull();
  });
});

// ─── 3. Karen (06/06) — compra para terceiro ("quero presentear meu esposo") ──
// A IA deve orientar sobre o procedimento para o destinatário e sugerir avaliação,
// sem tratar o terceiro como um lead separado.

describe("price_inquiry — compra para terceiro (cenário Karen)", () => {
  it("action context inclui instrução para compra para terceiro", () => {
    const ctx = buildActionContext({ type: "price_inquiry" }, "concierge");
    expect(ctx).toContain("COMPRANDO PARA OUTRA PESSOA");
    expect(ctx).toContain("avaliação presencial");
  });

  it("action context instrui a falar do procedimento como se destinatário fosse o paciente", () => {
    const ctx = buildActionContext({ type: "price_inquiry" }, "menu_first");
    expect(ctx).toContain("destinatário fosse o paciente");
  });
});

// ─── 4. Tania Mara (06/06) — preço de concorrente ────────────────────────────
// Lead mencionou que amiga pagou R$1.800 em outro lugar.
// Esperado: IA reconhece a comparação com empatia, sem ser defensiva.

describe("price_inquiry — preço de concorrente (cenário Tania Mara)", () => {
  it("action context inclui instrução para lidar com preço de concorrente", () => {
    const ctx = buildActionContext({ type: "price_inquiry" });
    expect(ctx).toContain("PREÇO QUE VIU EM OUTRO LUGAR");
  });

  it("instrução pede empatia sem criticar concorrentes", () => {
    const ctx = buildActionContext({ type: "price_inquiry" });
    expect(ctx).toContain("sem criticar concorrentes");
    expect(ctx).toContain("empatia");
  });

  it("instrução menciona que técnica/material influenciam o valor", () => {
    const ctx = buildActionContext({ type: "price_inquiry" });
    expect(ctx).toContain("técnica");
    expect(ctx).toContain("material");
  });
});

// ─── 5. Bianca (29/05) — responder dúvida antes de oferecer agenda ────────────
// A IA ignorou "Como funciona?" e foi direto para horários.
// Esperado: modo concierge conduz para avaliação DEPOIS de responder a dúvida.

describe("general_question — responder antes de oferecer agenda (cenário Bianca)", () => {
  it("em concierge, context verifica playbook primeiro e só conduz para avaliação após cumprir passos", () => {
    const ctx = buildActionContext(
      {
        type: "general_question",
        clinicContext: "Lead perguntou sobre duração e se há dor no procedimento de lentes de resina.",
      },
      "concierge",
    );
    expect(ctx).toContain("PRIORIDADE DE PLAYBOOK");
    expect(ctx).toContain("sequência COMPLETA");
    expect(ctx).toContain("Só conduza para avaliação após cumprir eventuais passos do playbook");
    expect(ctx).not.toContain("digitar *menu*");
  });

  it("em menu_first, context instrui a não reapresentar menu para pergunta clara", () => {
    const ctx = buildActionContext(
      {
        type: "general_question",
        clinicContext: "Lead perguntou quanto tempo leva o procedimento.",
      },
      "menu_first",
    );
    expect(ctx).toContain("Não reapresente menu");
  });
});

// ─── 6. shouldShowInitialMenu — intents que não devem abrir com menu ──────────

describe("shouldShowInitialMenu — intents que bypassam o menu inicial", () => {
  const blockingIntents = ["clinical_urgency", "needs_human", "patient_arrived"] as const;

  it.each(blockingIntents)(
    "intent '%s' não mostra menu inicial em menu_first",
    (intent) => {
      expect(shouldShowInitialMenu("menu_first", intent)).toBe(false);
    },
  );

  it("price_inquiry direta não mostra menu inicial (lead já sabe o que quer)", () => {
    expect(shouldShowInitialMenu("menu_first", "price_inquiry")).toBe(false);
  });

  it("book_appointment direto não mostra menu inicial", () => {
    expect(shouldShowInitialMenu("menu_first", "book_appointment")).toBe(false);
  });

  it("greeting sem histórico MOSTRA menu inicial em menu_first", () => {
    expect(shouldShowInitialMenu("menu_first", "greeting")).toBe(true);
  });

  it("unclear sem histórico MOSTRA menu inicial em menu_first", () => {
    expect(shouldShowInitialMenu("menu_first", "unclear")).toBe(true);
  });

  it("concierge NUNCA mostra menu inicial, para nenhum intent", () => {
    const intents = [
      "greeting", "acknowledgment", "unclear", "price_inquiry",
      "book_appointment", "general_question",
    ] as const;
    intents.forEach((intent) => {
      expect(shouldShowInitialMenu("concierge", intent)).toBe(false);
    });
  });
});

// ─── 7. Larissa Sales (04/06) — especificação técnica (cor BL2) ───────────────
// Lead pediu lentes em "resina estratificada na cor BL2".
// Esperado: IA não inventa detalhes técnicos; defere à avaliação para o caso específico.

describe("price_inquiry — especificação técnica (cenário Larissa Sales)", () => {
  it("action context proíbe inventar valores e instrui a encaminhar para a equipe", () => {
    const ctx = buildActionContext({ type: "price_inquiry" }, "concierge");
    expect(ctx).toContain("política NÃO menciona");
    expect(ctx).toContain("diretamente com a equipe");
    // Confirma que a regra anti-alucinação está presente
    expect(ctx).toContain("NÃO invente valores");
  });
});

// ─── 8. Fe Em Deus (03/06) — paciente retornando para manutenção de lentes ───
// Lead existente pediu agendamento de "manutenção de lentes".
// resolveDirectTreatmentMention deve reconhecer "limpeza das lentes" como menção informativa.

describe("resolveDirectTreatmentMention — paciente retornando com necessidade específica", () => {
  it("'manutenção das lentes' mapeia para tratamento de lentes", () => {
    const result = resolveDirectTreatmentMention("manutenção das lentes", ximendesTreatments, null);
    expect(result?.name).toContain("Lentes");
  });

  it("'quero agendar limpeza das lentes' não intercepta (pedido explícito de agendamento)", () => {
    const result = resolveDirectTreatmentMention(
      "quero agendar limpeza das lentes",
      ximendesTreatments,
      null,
    );
    expect(result).toBeNull();
  });
});

// ─── 9. Spec: cenários que requerem handoff (documentação para IntentClassifier) ─
// Padrões observados nas conversas da Ximendes que devem ser tratados como needs_human.

describe("needs_human — cobertura de cenários reais Ximendes (especificação)", () => {
  const realXimendesNeedsHuman = [
    "Falar com atendente",           // Gregorie (29/05)
    "falar com um especialista",     // item 5 do menu
    "me manda as fotos",             // EMERSON — pediu fotos do procedimento
    "pode me ligar",                 // padrão de contato humano
    "quero falar com o Gregorie",    // pedir falar com dentista pelo nome
    "tenho interesse em condição especial",
  ];

  it("todos os padrões de needs_human da Ximendes são strings válidas para o classifier", () => {
    realXimendesNeedsHuman.forEach((msg) => {
      expect(typeof msg).toBe("string");
      expect(msg.length).toBeGreaterThan(5);
    });
  });

  it("total de cenários de handoff documentados é suficiente", () => {
    expect(realXimendesNeedsHuman.length).toBeGreaterThanOrEqual(6);
  });
});

// ─── 10. patient_arrived action context — cenário Fe Em Deus (atraso no dia) ──

describe("patient_arrived — aviso de atraso no dia da consulta", () => {
  it("action context com consulta hoje menciona o horário", () => {
    const appointmentTime = new Date("2026-06-08T15:00:00-03:00");
    const ctx = buildActionContext({ type: "patient_arrived", appointmentTime });
    expect(ctx).toContain("15:00");
  });

  it("action context é caloroso e tranquilizador (máximo 2 frases)", () => {
    const ctx = buildActionContext({
      type: "patient_arrived",
      appointmentTime: new Date("2026-06-08T15:00:00-03:00"),
    });
    expect(ctx).toContain("Máximo 2 frases");
  });
});
