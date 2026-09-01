import { describe, expect, it, vi } from "vitest";
import type { CapabilityContext, ConversationState } from "@/conversation-core/capability/contract";
import type { Understanding } from "@/conversation-core/understanding/schema";
import { UNDERSTANDING_VERSION } from "@/conversation-core/understanding/schema";
import {
  DENTAL_OUTCOME_SCHEMA,
  type DentalPolicy,
} from "@/domain-packs/dental/capabilities";
import { createDentalPlaybookKnowledgeCapability } from "@/domain-packs/dental/playbook-knowledge-capability";
import type {
  DentalPlaybookKnowledgeReadPort,
  DentalPlaybookKnowledgeResolution,
} from "@/domain-packs/dental/ports";
import type { DentalRequest } from "@/domain-packs/dental/vocabulary";
import { buildV2AuthorizedResponsePlan } from "@/conversation-core/authorized-response-plan";
import { authorizedSurfaceFor } from "@/conversation-core/composer/authorized-surface";
import { buildDeterministicDraft } from "@/conversation-core/composer/deterministic-composer";
import { validateDraft } from "@/conversation-core/composer/validator";

const state: ConversationState = { phase: "idle", pendingStepId: null, completedStepIds: [] };
const context: CapabilityContext<DentalPolicy> = {
  state,
  policy: {
    priceDisclosureEnabled: true,
    humanEscalationRequired: false,
    schedulingMinimumLeadTimeHours: 2,
    schedulingRequiresEvaluationFirst: false,
  },
  now: new Date("2026-09-01T12:00:00.000Z"),
};

function understanding(
  request: "business-differentials" | "frequently-asked-question",
  faqQuestion: string | null = null,
): Understanding<DentalRequest> {
  return {
    version: UNDERSTANDING_VERSION,
    request,
    dialogueMove: "new_topic",
    entities: {
      service: null,
      businessInformationTopic: null,
      date: null,
      period: null,
      time: null,
      serviceCandidates: null,
      faqQuestion,
      quantity: null,
      ordinal: null,
    },
    signals: { purchaseIntent: null, priceSensitivity: null, sentiment: null, objection: null },
    safety: { optOut: false, requestsHuman: false, emergency: false },
    confidence: 1,
    ambiguity: null,
  };
}

function port(resolution: DentalPlaybookKnowledgeResolution): DentalPlaybookKnowledgeReadPort {
  return {
    resolveDifferentials: vi.fn().mockResolvedValue(resolution),
    resolveFaq: vi.fn().mockResolvedValue(resolution),
  };
}

const differentials: DentalPlaybookKnowledgeResolution = {
  kind: "resolved",
  request: "business-differentials",
  organization: { id: "clinic-1", displayName: "Clínica Exemplo" },
  facts: [
    { key: "business_differential", value: "Atendimento individualizado.", evidenceRef: "playbook:v7:differential:0" },
    { key: "business_differential", value: "Planejamento digital.", evidenceRef: "playbook:v7:differential:1" },
  ],
};

describe("capability de conhecimento do playbook", () => {
  it("autoriza os diferenciais ativos em ordem estável", async () => {
    const capability = createDentalPlaybookKnowledgeCapability(port(differentials));
    const claim = capability.claim(understanding("business-differentials"), state)!;
    const result = await capability.execute(await capability.decide(claim, context), context);

    expect(claim).toMatchObject({
      capabilityId: "dental-playbook-knowledge",
      payload: { kind: "playbook-knowledge", request: "business-differentials" },
    });
    expect(result).toMatchObject({
      type: "playbook_knowledge_answered",
      subject: { type: "organization", id: "clinic-1" },
      facts: [
        { value: { value: "Atendimento individualizado." }, evidence: { reference: "playbook:v7:differential:0" } },
        { value: { value: "Planejamento digital." }, evidence: { reference: "playbook:v7:differential:1" } },
      ],
    });
    expect(DENTAL_OUTCOME_SCHEMA[result.type].semanticClass).toBe("information_authorized");
    const plan = buildV2AuthorizedResponsePlan(DENTAL_OUTCOME_SCHEMA, [result]);
    const validation = validateDraft(plan, buildDeterministicDraft(plan));
    expect(validation.valid).toBe(true);
    if (!validation.valid) throw new Error(JSON.stringify(validation.violations));
    expect(authorizedSurfaceFor(validation.draft).values).toEqual([
      "Atendimento individualizado.",
      "Planejamento digital.",
    ]);
  });

  it("autoriza somente a resposta da pergunta canônica selecionada", async () => {
    const resolution: DentalPlaybookKnowledgeResolution = {
      kind: "resolved",
      request: "frequently-asked-question",
      organization: { id: "clinic-1", displayName: "Clínica Exemplo" },
      facts: [{ key: "faq_answer", value: "Não é necessário.", evidenceRef: "playbook:v7:faq:0" }],
    };
    const read = port(resolution);
    const capability = createDentalPlaybookKnowledgeCapability(read);
    const claim = capability.claim(understanding("frequently-asked-question", "Preciso de encaminhamento?"), state)!;
    const result = await capability.execute(await capability.decide(claim, context), context);

    expect(read.resolveFaq).toHaveBeenCalledWith("Preciso de encaminhamento?");
    expect(result).toMatchObject({
      type: "playbook_knowledge_answered",
      facts: [{ key: "faq_answer", value: { value: "Não é necessário." } }],
    });
  });

  it.each([
    ["ausente", { kind: "missing", request: "frequently-asked-question" }],
    ["malformado", {
      ...differentials,
      facts: [{ key: "business_differential", value: " texto inválido ", evidenceRef: "playbook:v7:differential:0" }],
    }],
  ] as const)("pede esclarecimento para dado %s", async (_label, resolution) => {
    const capability = createDentalPlaybookKnowledgeCapability(port(resolution as DentalPlaybookKnowledgeResolution));
    const claim = capability.claim(understanding(
      resolution.request,
      resolution.request === "frequently-asked-question" ? "Pergunta ausente?" : null,
    ), state)!;

    expect(await capability.decide(claim, context)).toEqual({
      kind: "ask",
      questionId: "playbook-knowledge-not-registered",
    });
  });

  it("não reivindica FAQ sem pergunta nem turnos de safety", () => {
    const capability = createDentalPlaybookKnowledgeCapability(port(differentials));
    expect(capability.claim(understanding("frequently-asked-question"), state)).toBeNull();
    expect(capability.claim({
      ...understanding("business-differentials"),
      safety: { optOut: false, requestsHuman: true, emergency: false },
    }, state)).toBeNull();
  });
});
