import { describe, expect, it, vi } from "vitest";
import { buildV2AuthorizedResponsePlan } from "@/conversation-core/authorized-response-plan";
import {
  authorizedStatementsFor,
  authorizedSurfaceFor,
} from "@/conversation-core/composer/authorized-surface";
import { buildDeterministicDraft } from "@/conversation-core/composer/deterministic-composer";
import { validateDraft } from "@/conversation-core/composer/validator";
import type { SpeakerProfile, VerbalizationRequest } from "@/conversation-core/composer/verbalization";
import { defineOutcomeSchema, type ActionResult } from "@/conversation-core/decision";
import {
  assertRegisteredLiveResponseVerbalizer,
  createLiveResponseVerbalizer,
  LiveResponseVerbalizer,
} from "@/infrastructure/adapters/ai/live-response-verbalizer";

const SCHEMA = defineOutcomeSchema({
  quote_ready: {
    semanticClass: "information_authorized",
    subjectRequirement: "required",
    evidenceRequirement: "required",
  },
} as const);

const item = { type: "item", id: "a", displayName: "Item A" } as const;
const evidence = { source: "read", reference: "snapshot" } as const;
const results: ActionResult<typeof SCHEMA>[] = [{
  type: "quote_ready",
  semanticClass: "information_authorized",
  origin: { capabilityId: "quote" },
  subject: item,
  evidence: [evidence],
  facts: [{
    key: "price_cents",
    value: { kind: "money", amountInMinor: 29000, currency: "BRL" },
    subject: item,
    evidence,
    disclosure: "allowed",
  }],
}];

const speaker: SpeakerProfile = Object.freeze({
  agentName: "Marina",
  organizationName: "Casa Exemplo",
  specialty: "estética",
  toneOfVoice: "acolhedor e objetivo",
  guidelines: Object.freeze(["Responder primeiro, perguntar depois."]),
});

function request(): VerbalizationRequest<"quote_ready"> {
  const plan = buildV2AuthorizedResponsePlan(SCHEMA, results);
  const validation = validateDraft(plan, buildDeterministicDraft(plan));
  if (!validation.valid) throw new Error(JSON.stringify(validation.violations));
  return Object.freeze({
    plan,
    draft: validation.draft,
    surface: authorizedSurfaceFor(validation.draft),
    authorizedText: 'Para "Item A", valor: R$ 290,00.',
    statements: authorizedStatementsFor(validation.draft),
    style: { tone: "warm", verbosity: "concise", greeting: "omit", emoji: "none" } as const,
    speaker,
  });
}

function clientReturning(text: unknown) {
  return vi.fn().mockResolvedValue({
    choices: [{ message: { content: JSON.stringify({ text }) } }],
  });
}

describe("verbalizador vivo de resposta", () => {
  it("devolve a prosa do modelo pela identidade fechada de modelo", async () => {
    const create = clientReturning("Fica R$ 290,00. Quer que eu veja um horário?");
    const verbalizer = createLiveResponseVerbalizer({ chat: { completions: { create } } });

    await expect(verbalizer.verbalize(request()))
      .resolves.toBe("Fica R$ 290,00. Quer que eu veja um horário?");
    expect(verbalizer.modelId).toBe("gpt-4o-mini");
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-4o-mini" }));
  });

  it("entrega ao modelo as intenções, os números permitidos e a voz da empresa", async () => {
    const create = clientReturning("Fica R$ 290,00.");
    const verbalizer = createLiveResponseVerbalizer({ chat: { completions: { create } } });

    await verbalizer.verbalize(request());

    const payload = JSON.parse(create.mock.calls[0]![0].messages[1].content) as Record<string, unknown>;
    expect(payload).toMatchObject({
      statements: [{ meaning: "inform_fact", subject: "Item A", values: ["R$ 290,00"] }],
      allowedNumbers: ["290"],
      moneyNumbers: ["290"],
      maxQuestions: 1,
      speaker: {
        agentName: "Marina",
        organizationName: "Casa Exemplo",
        specialty: "estética",
        toneOfVoice: "acolhedor e objetivo",
        guidelines: ["Responder primeiro, perguntar depois."],
      },
    });
  });

  it("não manda a frase da máquina, para o modelo escrever do sentido e não copiar", async () => {
    const create = clientReturning("Fica R$ 290,00.");
    const verbalizer = createLiveResponseVerbalizer({ chat: { completions: { create } } });

    await verbalizer.verbalize(request());

    const raw = create.mock.calls[0]![0].messages[1].content as string;
    expect(raw).not.toContain("Para \\\"Item A\\\", valor");
    expect(Object.keys(JSON.parse(raw) as Record<string, unknown>)).not.toContain("authorizedText");
  });

  it("falha quando o modelo não devolve texto, em vez de inventar um", async () => {
    const create = vi.fn().mockResolvedValue({ choices: [{ message: { content: null } }] });
    const verbalizer = createLiveResponseVerbalizer({ chat: { completions: { create } } });

    await expect(verbalizer.verbalize(request())).rejects.toThrow();
  });

  it("recusa uma instância forjada antes de qualquer chamada falsa", async () => {
    const fake = vi.fn();
    const forged = Reflect.construct(LiveResponseVerbalizer, [{ verbalize: fake }]) as LiveResponseVerbalizer;

    expect(() => assertRegisteredLiveResponseVerbalizer(forged)).toThrow(
      "unregistered live response verbalizer",
    );
    expect(fake).not.toHaveBeenCalled();
  });
});
