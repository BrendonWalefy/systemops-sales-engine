/**
 * Replay determinístico e sem escrita dos casos reais reportados em 19/07.
 * Não chama WhatsApp, OpenAI ou banco de produção.
 */
import assert from "node:assert/strict";
import {
  buildEvaluationDepositClarification,
  contextualizeReplyWhileAwaitingDeposit,
  extractExplicitPreferredDateFromText,
  isBusinessHoursQuestion,
  isClinicalTreatmentPlanJudgmentRequest,
  isProcedureCatalogRequest,
  resolvePipelineSourceTreatment,
} from "../src/core/pipeline/ConversationOrchestrator";
import {
  buildHumanReviewContextUpdateMessage,
  buildHumanReviewPendingLeadMessage,
  buildHumanReviewRequestMessage,
} from "../src/domain/entities/human-review";
import type { Treatment } from "../src/domain/entities/treatment";
import { normalizeManualWhatsAppPhone } from "../src/core/whatsapp/WhatsAppContactIdentity";

function treatment(name: string, overrides: Partial<Treatment> = {}): Treatment {
  return {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    clinicId: "vitalli",
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
    priceKind: "fixed",
    priceUnit: null,
    priceDeductible: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

const results: string[] = [];
function check(name: string, fn: () => void) {
  fn();
  results.push(`✓ ${name}`);
}

check("Tatiana: 8/8 é disponibilidade, não horário de funcionamento", () => {
  const input = "Me agenda por gentileza dia 8/8 se tiver horário";
  assert.equal(isBusinessHoursQuestion(input), false);
  assert.equal(extractExplicitPreferredDateFromText(input), "8/8");
});

check("Nataly: avaliação grátis e R$30 somente como sinal", () => {
  const reply = buildEvaluationDepositClarification(3000);
  assert.match(reply, /avaliação não tem custo/i);
  assert.match(reply, /sinal de R\$ 30/i);
  assert.match(reply, /não é uma cobrança pela avaliação/i);
});

check("Nataly: combinação clínica escala para o doutor", () => {
  assert.equal(isClinicalTreatmentPlanJudgmentRequest("Então se for só pra fechar os espacinhos"), true);
  assert.equal(isClinicalTreatmentPlanJudgmentRequest("Pouca resina + clareamento"), true);
  assert.doesNotMatch(buildHumanReviewPendingLeadMessage("Nataly"), /horários disponíveis/i);
  assert.match(
    buildHumanReviewContextUpdateMessage({ reviewCode: 2, leadName: "Nataly", leadMessage: "Pouca resina + clareamento" }),
    /Avaliação A2/,
  );
});

check("Doutor: notificação identifica caso e paciente mesmo sem botões", () => {
  const message = buildHumanReviewRequestMessage({
    reviewCode: 2,
    leadName: "Nataly",
    treatmentName: "Lentes em Resina Composta",
    mediaLabel: "foto",
  });
  assert.match(message, /Código A2/);
  assert.match(message, /Paciente: Nataly/);
  assert.match(message, /A2 1/);
  assert.match(message, /A2 4/);
});

check("Henrique: dúvida singular não abre catálogo", () => {
  assert.equal(isProcedureCatalogRequest("Tenho dúvidas sobre o procedimento"), false);
});

check("Henrique: variante Estratificada usa pipeline canônico com imagens", () => {
  const parent = treatment("Lentes em Resina Composta", {
    id: "lentes",
    pipelineSteps: [{ type: "content", label: "Cards", blocks: [{ kind: "media", mediaId: "foto-1" }] }],
  });
  const child = treatment("Lente em Resina Estratificada", {
    pipelineSourceTreatmentId: parent.id,
  });
  assert.equal(resolvePipelineSourceTreatment(child, [child, parent]), parent);
});

check("Henrique: sinal pendente não reabre agenda", () => {
  const reply = contextualizeReplyWhileAwaitingDeposit(
    "Parcelamos em até 21x.\n\nPosso ver os horários disponíveis para sua avaliação?",
    "Seg 27/07 às 9h",
  );
  assert.doesNotMatch(reply, /Posso ver os horários/i);
  assert.match(reply, /continua reservado provisoriamente/i);
});

check("Ximendes: telefone manual recebe DDI para lembrete", () => {
  assert.equal(normalizeManualWhatsAppPhone("(11) 99016-1996"), "5511990161996");
});

console.log(results.join("\n"));
console.log(`\n${results.length} cenários verificados sem escrita externa.`);
