// Guards determinísticos P0 — casos reais das conversas da Horizonte (jun-jul/2026):
// starter genérico engolindo pergunta de negócio (Tania, Julllys, Carla),
// follow-up de madrugada (lote de 02:43), oferta expirada dita "indisponível"
// com o mesmo horário na lista (Aylane), markdown ** cru no WhatsApp.
import { describe, expect, it } from "vitest";
import {
  buildBusinessHoursAnswer,
  coerceBusinessIntent,
  detectPatientArrivalText,
  extractSocialProfileInfo,
  findExpressedSlotIndex,
  shouldBypassPendingPipelineContent,
  hasExplicitPipelineTreatmentTrigger,
  isBusinessHoursQuestion,
  isSimplePaymentPolicyQuestion,
  resolvePipelineSourceTreatment,
  resolvePipelineEntryBehavior,
  shouldDeferTreatmentPipelineEntry,
} from "@/core/pipeline/ConversationOrchestrator";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import { toWhatsAppFormatting } from "@/infrastructure/adapters/channels/whatsapp/whatsapp-sender";
import type { Treatment } from "@/domain/entities/treatment";

function treatment(name: string, overrides: Partial<Treatment> = {}): Treatment {
  return {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    clinicId: "clinic-1",
    name,
    durationMinutes: 60,
    description: null,
    requiresEvaluationFirst: false,
    keywordMatchEnabled: true,
    aliases: [],
    isAesthetic: false,
    pipelineSteps: null,
    priceCents: null,
    minPriceCents: null,
    maxPriceCents: null,
    priceQuotableInChat: false,
    priceKind: "from",
    priceUnit: null,
    priceDeductible: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

const treatments = [
  treatment("Lentes de resina composta", { aliases: ["lentes", "faceta"] }),
  treatment("Clareamento dental", { aliases: ["clareamento"] }),
];

const saoPaulo = new ClinicTimezone("America/Sao_Paulo");

describe("coerceBusinessIntent", () => {
  it("pergunta de preço classificada como acknowledgment vira price_inquiry (caso Tania)", () => {
    const result = coerceBusinessIntent({
      message: "Olá! Posso ter mais informações sobre custo ?",
      intent: "acknowledgment",
      treatments,
      isClinicSegment: true,
    });
    expect(result).toBe("price_inquiry");
  });

  it("pergunta de valores classificada como greeting vira price_inquiry (caso Julllys)", () => {
    const result = coerceBusinessIntent({
      message: "Olá boa tarde!! E qual seria os valores?",
      intent: "greeting",
      treatments,
      isClinicSegment: true,
    });
    expect(result).toBe("price_inquiry");
  });

  it("aviso de chegada classificado como acknowledgment vira patient_arrived (caso Carla)", () => {
    const result = coerceBusinessIntent({
      message: "Oi, bom dia, tudo bem? Eu estou aqui na frente mas ninguém atende.",
      intent: "acknowledgment",
      treatments,
      isClinicSegment: true,
    });
    expect(result).toBe("patient_arrived");
  });

  it("menção direta a tratamento classificada como unclear vira general_question", () => {
    const result = coerceBusinessIntent({
      message: "clareamento",
      intent: "unclear",
      treatments,
      isClinicSegment: true,
    });
    expect(result).toBe("general_question");
  });

  it("saudação pura permanece greeting", () => {
    const result = coerceBusinessIntent({
      message: "Boa noite",
      intent: "greeting",
      treatments,
      isClinicSegment: true,
    });
    expect(result).toBe("greeting");
  });

  it("não sobrescreve intents de negócio já corretos", () => {
    const result = coerceBusinessIntent({
      message: "quanto custa o clareamento?",
      intent: "price_inquiry",
      treatments,
      isClinicSegment: true,
    });
    expect(result).toBe("price_inquiry");
  });

  it("chegada não dispara fora do segmento clínico", () => {
    const result = coerceBusinessIntent({
      message: "cheguei",
      intent: "acknowledgment",
      treatments,
      isClinicSegment: false,
    });
    expect(result).toBe("acknowledgment");
  });

  it("pergunta de horário de atendimento vira general_question, não agendamento", () => {
    const result = coerceBusinessIntent({
      message: "Vocês atendem aos sábados?",
      intent: "acknowledgment",
      treatments,
      isClinicSegment: true,
    });
    expect(result).toBe("general_question");
  });
});

describe("perguntas simples de política comercial", () => {
  it("parcelamento simples não é exceção humana", () => {
    expect(isSimplePaymentPolicyQuestion("esse valor pode ser parcelado?")).toBe(true);
    expect(isSimplePaymentPolicyQuestion("Esses 2,000.00 vocês parcelam?")).toBe(true);
  });

  it("condição especial continua fora da automação", () => {
    expect(isSimplePaymentPolicyQuestion("tem como parcelar diferente?")).toBe(false);
    expect(isSimplePaymentPolicyQuestion("consegue um desconto especial?")).toBe(false);
  });

  // Item #10 do plano de correção: preço e pagamento na MESMA frase. Auditado em
  // produção em 21/07 e já resolvido — estas frases reais existem só para travar
  // a regressão, porque o caminho é uma composição de dois guards (coerção de
  // intent + guard de pagamento no orquestrador) e nenhum dos dois sozinho
  // cobre todas elas.
  it.each([
    "Gostaria de saber valores e formas de pagamento",
    "Quero sabe valores e formas de pagamento e fazer uma avaliação",
    "sim, gostaria de saber o valor para colocar as lentes, se passar cartão",
    "E quanto fica o valor parcelado?",
    // Caiu em acknowledgment em produção (Horizonte, 04/06) e o lead recebeu o
    // menu de boas-vindas em vez do preço.
    "Tenho interesse em lentes de resina estratificadas na cor BL2. Gostaria de saber o valor aproximado",
  ])("pergunta composta de preço + pagamento vira price_inquiry: %s", (frase) => {
    expect(
      coerceBusinessIntent({ message: frase, intent: "unclear", treatments, isClinicSegment: true }),
    ).toBe("price_inquiry");
  });

  it("parcelamento sem a palavra 'valor' também chega a price_inquiry pelo guard do orquestrador", () => {
    // Caso real (Aurora, 19/07 01:34): "Esse valor pode ser parcelado ?" foi
    // classificada needs_human e a resposta certa saiu com um rabo indevido —
    // "Já avisei a equipe sobre sua dúvida e eles vão te responder em breve!".
    //
    // O guard que corrige isso (a772f57) só chegou à main às 17:56 do MESMO dia,
    // ~16h depois da mensagem. Não é bug vivo: é a evidência de que o guard é
    // necessário. Sem este teste, removê-lo silenciosamente traria a escalação
    // de volta — e escalar parcelamento é justamente o que o Silva não quer.
    const frase = "Esse valor pode ser parcelado ?";
    expect(isSimplePaymentPolicyQuestion(frase)).toBe(true);
    expect(coerceBusinessIntent({ message: frase, intent: "unclear", treatments, isClinicSegment: true })).toBe("price_inquiry");
  });
});

describe("horário de atendimento determinístico", () => {
  it("detecta pergunta de atendimento aos sábados", () => {
    expect(isBusinessHoursQuestion("Vocês atendem aos sábados?")).toBe(true);
    expect(isBusinessHoursQuestion("Quero agendar sábado")).toBe(false);
  });

  it("não confunde data concreta de agendamento com horário institucional (caso Tatiana)", () => {
    expect(isBusinessHoursQuestion("Me agenda por gentileza dia 8/8 se tiver horário")).toBe(false);
    expect(isBusinessHoursQuestion("Tem horário dia 08/08?")).toBe(false);
    expect(isBusinessHoursQuestion("Qual o horário de funcionamento no dia 08/08?")).toBe(true);
  });

  it("saudação + 'como funciona X' NÃO é pergunta de horário (caso SP/ZN 23/07)", () => {
    // "funciona" (de "como funciona o orçamento") + "dia" (de "bom dia") casavam
    // como pergunta de expediente e o lead quente recebia o texto de horário.
    expect(
      isBusinessHoursQuestion(
        "Bom dia Dr, tudo bem? Me chamo Guilherme. Quero iniciar as lentes em resina, como funciona o orçamento?",
      ),
    ).toBe(false);
    expect(isBusinessHoursQuestion("Boa noite Dr. Quero iniciar as lentes, como funciona o orçamento?")).toBe(false);
    expect(isBusinessHoursQuestion("Bom dia! Como funciona o tratamento?")).toBe(false);
    expect(isBusinessHoursQuestion("Boa tarde, como funciona o pagamento?")).toBe(false);
  });

  it("preserva perguntas legítimas de expediente mesmo com saudação e 'funciona'", () => {
    expect(isBusinessHoursQuestion("Bom dia, vocês atendem aos sábados?")).toBe(true);
    expect(isBusinessHoursQuestion("Vocês funcionam aos sábados?")).toBe(true);
    expect(isBusinessHoursQuestion("A clínica funciona de manhã?")).toBe(true);
    expect(isBusinessHoursQuestion("Boa tarde, atendem à tarde?")).toBe(true);
  });

  it("responde sábado a partir do businessHours cadastrado", () => {
    expect(
      buildBusinessHoursAnswer("Segunda a sexta das 8h às 18h. Sábado das 8h às 13h.", "Vocês atendem aos sábados?"),
    ).toContain("Sim, atendemos aos sábados");

    // Sábado fora da agenda padrão não é mais uma negativa seca: a clínica abre
    // exceção, então a resposta informa o cadastrado E escala para a equipe.
    // Ver BusinessHoursOutOfWindow.test.ts.
    const semSabado = buildBusinessHoursAnswer("Seg-Sex 09:00-18:00", "Vocês atendem aos sábados?");
    expect(semSabado).toContain("não consta na agenda padrão");
    expect(semSabado).not.toContain("verificar com a equipe");

    const comExcecao = buildBusinessHoursAnswer(
      "Seg-Sex 09:00-18:00",
      "Vocês atendem aos sábados?",
      true,
    );
    expect(comExcecao).toContain("verificar com a equipe");
  });
});

describe("hasExplicitPipelineTreatmentTrigger", () => {
  it("não inicia pipeline quando o tratamento só veio da identificação contextual", () => {
    const lenses = treatments[0];
    expect(
      hasExplicitPipelineTreatmentTrigger({
        message: "Vou fazer uns levantamentos e volto a chamar.",
        treatments,
        treatment: lenses,
      }),
    ).toBe(false);
  });

  it("permite pipeline quando o lead menciona o tratamento na mensagem atual", () => {
    const lenses = treatments[0];
    expect(
      hasExplicitPipelineTreatmentTrigger({
        message: "Quero saber mais sobre lentes.",
        treatments,
        treatment: lenses,
      }),
    ).toBe(true);
  });

  // Regressão 18/07: os openers reais dos anúncios da Aurora têm mais de 8
  // palavras e caíam no teto do resolveDirectTreatmentMention — todo lead de
  // tráfego pago perdia a saudação concierge e o pipeline de lentes.
  it("permite pipeline com o opener longo do anúncio (13 palavras)", () => {
    const lenses = treatment("Lentes de resina composta", {
      aliases: ["lentes", "faceta"],
      pipelineSteps: [{ type: "content", label: "Apresentação", blocks: [] }],
    });
    expect(
      hasExplicitPipelineTreatmentTrigger({
        message: "Olá! Quero saber como posso transformar meu sorriso com as lentes  de resina?",
        treatments: [lenses, ...treatments.slice(1)],
        treatment: lenses,
      }),
    ).toBe(true);
  });

  it("permite pipeline com o opener curto do anúncio (9 palavras)", () => {
    const lenses = treatment("Lentes de resina composta", {
      aliases: ["lentes", "faceta"],
      pipelineSteps: [{ type: "content", label: "Apresentação", blocks: [] }],
    });
    expect(
      hasExplicitPipelineTreatmentTrigger({
        message: "Olá, quero saber mais sobre as lentes em resina !",
        treatments: [lenses, ...treatments.slice(1)],
        treatment: lenses,
      }),
    ).toBe(true);
  });

  it("mensagem longa sem menção textual continua bloqueada", () => {
    const lenses = treatment("Lentes de resina composta", {
      aliases: ["lentes", "faceta"],
      pipelineSteps: [{ type: "content", label: "Apresentação", blocks: [] }],
    });
    expect(
      hasExplicitPipelineTreatmentTrigger({
        message: "Vou conversar com minha esposa e qualquer coisa volto a falar com vocês, obrigado.",
        treatments: [lenses, ...treatments.slice(1)],
        treatment: lenses,
      }),
    ).toBe(false);
  });
});

describe("pipeline canônico compartilhado por variantes", () => {
  it("faz Premium/Estratificada reutilizarem o pipeline pai sem duplicar steps", () => {
    const parent = treatment("Lentes em Resina Composta", {
      id: "lenses-parent",
      pipelineSteps: [{ type: "content", label: "Cards e fotos", blocks: [] }],
    });
    const child = treatment("Lente em Resina Estratificada", {
      id: "layered-child",
      pipelineSourceTreatmentId: parent.id,
    });
    expect(resolvePipelineSourceTreatment(child, [child, parent])).toBe(parent);
  });

  it("faz fallback seguro se o vínculo estiver órfão ou for de outra clínica", () => {
    const child = treatment("Lente em Resina Estratificada", {
      pipelineSourceTreatmentId: "missing",
    });
    expect(resolvePipelineSourceTreatment(child, [child])).toBe(child);
  });

  it("herda o modo de entrada do canônico e permite override na variante", () => {
    const parent = treatment("Lentes em Resina Composta", {
      id: "lenses-parent",
      pipelineEntryBehavior: "immediate",
      pipelineSteps: [{ type: "content", label: "Cards e fotos", blocks: [] }],
    });
    const inherited = treatment("Lente em Resina Premium", {
      id: "premium-child",
      pipelineSourceTreatmentId: parent.id,
    });
    const overridden = treatment("Lente em Resina Estratificada", {
      id: "layered-child",
      pipelineSourceTreatmentId: parent.id,
      pipelineEntryBehavior: "qualify_then_present",
    });

    expect(resolvePipelineEntryBehavior(inherited, [inherited, parent])).toBe("immediate");
    expect(resolvePipelineEntryBehavior(overridden, [overridden, parent])).toBe("qualify_then_present");
    expect(
      shouldDeferTreatmentPipelineEntry({
        treatment: inherited,
        treatments: [inherited, parent],
        isConversationOpening: true,
        legacyShouldDefer: true,
      }),
    ).toBe(false);
    expect(
      shouldDeferTreatmentPipelineEntry({
        treatment: overridden,
        treatments: [overridden, parent],
        isConversationOpening: true,
        legacyShouldDefer: false,
      }),
    ).toBe(true);
  });
});

describe("detectPatientArrivalText", () => {
  it("detecta variações reais de chegada", () => {
    expect(detectPatientArrivalText("cheguei")).toBe(true);
    expect(detectPatientArrivalText("Já estou aí na recepção")).toBe(true);
    expect(detectPatientArrivalText("to na porta")).toBe(true);
  });

  it("não dispara com 'estou aqui' genérico", () => {
    expect(detectPatientArrivalText("estou aqui pensando nos valores")).toBe(false);
  });
});

describe("shouldBypassPendingPipelineContent", () => {
  it("não deixa pergunta de localização disparar conteúdo pendente do pipeline", () => {
    expect(shouldBypassPendingPipelineContent("Vocês é de onde?")).toBe(true);
  });

  it("não deixa pergunta de Instagram disparar conteúdo pendente do pipeline", () => {
    expect(shouldBypassPendingPipelineContent("E vocês tem instagran?")).toBe(true);
  });

  it("trata dúvida sobre foto/prêmio como esclarecimento da Premium", () => {
    expect(shouldBypassPendingPipelineContent("Qual dessa da foto é a prêmio")).toBe(true);
  });

  it("não bloqueia continuação normal do pipeline para mensagem comercial simples", () => {
    expect(shouldBypassPendingPipelineContent("Ver valores")).toBe(false);
  });
});

describe("extractSocialProfileInfo", () => {
  it("extrai o Instagram da resposta validada da Aurora", () => {
    const source =
      "Claro 😊 Este é o Instagram da Clínica Vittali: https://www.instagram.com/clinic.vittali  Dá uma olhadinha nos nossos trabalhos com lentes em resina e nos destaques.";

    expect(extractSocialProfileInfo(source)).toBe("https://www.instagram.com/clinic.vittali");
  });

  it("não inventa perfil quando o playbook não traz Instagram", () => {
    expect(extractSocialProfileInfo("Clínica especialista em lentes de resina composta.")).toBeNull();
  });
});

describe("ClinicTimezone.isWithinContactWindow", () => {
  it("bloqueia madrugada local (caso do lote de 02:43 BRT)", () => {
    // 05:43 UTC = 02:43 em São Paulo
    expect(saoPaulo.isWithinContactWindow(new Date("2026-06-15T05:43:11Z"))).toBe(false);
  });

  it("permite horário comercial local", () => {
    // 13:00 UTC = 10:00 em São Paulo
    expect(saoPaulo.isWithinContactWindow(new Date("2026-07-03T13:00:00Z"))).toBe(true);
  });

  it("bloqueia após o fim da janela", () => {
    // 23:30 UTC = 20:30 em São Paulo
    expect(saoPaulo.isWithinContactWindow(new Date("2026-07-03T23:30:00Z"))).toBe(false);
  });
});

describe("findExpressedSlotIndex", () => {
  // Sex 03/07/2026: 08h, 09h e 12h locais (UTC-3)
  const slots = [
    { index: 1, startsAt: "2026-07-03T11:00:00.000Z" },
    { index: 2, startsAt: "2026-07-03T12:00:00.000Z" },
    { index: 3, startsAt: "2026-07-03T15:00:00.000Z" },
    { index: 4, startsAt: "2026-07-06T15:00:00.000Z" },
  ];

  it("aponta o horário pedido quando é único (caso Aylane: 'As 12hs' + sexta)", () => {
    const index = findExpressedSlotIndex({
      slots,
      preferredTime: "As 12hs",
      preferredDay: new Date("2026-07-03T15:00:00.000Z"),
      timezone: saoPaulo,
    });
    expect(index).toBe(3);
  });

  it("retorna null quando a hora casa com mais de um dia (ambíguo)", () => {
    const index = findExpressedSlotIndex({
      slots,
      preferredTime: "12h",
      preferredDay: null,
      timezone: saoPaulo,
    });
    expect(index).toBeNull();
  });

  it("retorna null quando o horário pedido não existe na lista", () => {
    const index = findExpressedSlotIndex({
      slots,
      preferredTime: "16:00",
      preferredDay: null,
      timezone: saoPaulo,
    });
    expect(index).toBeNull();
  });

  it("retorna null sem preferência expressa", () => {
    expect(findExpressedSlotIndex({ slots, preferredTime: null, preferredDay: null, timezone: saoPaulo })).toBeNull();
  });
});

describe("toWhatsAppFormatting", () => {
  it("converte markdown bold para o formato do WhatsApp", () => {
    expect(toWhatsAppFormatting("**Técnica Simplificada**: a partir de R$2.500")).toBe(
      "*Técnica Simplificada*: a partir de R$2.500",
    );
  });

  it("não altera texto sem markdown", () => {
    expect(toWhatsAppFormatting("Valor *promocional* até sexta")).toBe("Valor *promocional* até sexta");
  });
});
