import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConversationResponsePlanner,
  type PlannedResponse,
} from "@/core/conversation/ConversationResponsePlanner";
import type { BuildResponsePlanInput } from "@/core/conversation/response-plan";
import { InMemoryDecisionTraceSink } from "@/core/observability/DecisionTrace";
import * as orchestratorModule from "@/core/pipeline/ConversationOrchestrator";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import { TurnSafetyHandoffGuard } from "@/core/conversation/TurnSafetyHandoffGuard";
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

  it.each([
    ["resposta inválida", "response_plan_violation"],
    ["erro do provider", "composer_error"],
  ] as const)(
    "preserva a ação autorizada no fallback após mutação aninhada do composer: %s",
    async (_scenario, fallbackReason) => {
      const originalLabel = "Seg 10/08 às 14h";
      const mutatedLabel = "Ter 11/08 às 19h";
      const executionInput = {
        ...input(),
        composerInput: {
          ...validComposerInput,
          actionResult: {
            type: "slots_found" as const,
            askedForPreference: false,
            slots: [{
              index: 1,
              startsAt: "2026-08-10T17:00:00.000Z",
              endsAt: "2026-08-10T18:00:00.000Z",
              label: originalLabel,
            }],
          },
        },
      };
      const composer = {
        compose: async (composerInput: ComposerInput): Promise<ComposedResponse> => {
          if (composerInput.actionResult.type !== "slots_found") {
            throw new Error("unexpected action");
          }
          composerInput.actionResult.slots[0]!.label = mutatedLabel;
          if (fallbackReason === "composer_error") {
            throw new Error("provider failure after mutation");
          }
          return composed("Custa R$ 9.999,00");
        },
      };

      const result = await new ConversationResponsePlanner(composer).execute(executionInput);

      expect(result.response.text).toBe(`Horários disponíveis:\n- ${originalLabel}`);
      expect(result.response.text).not.toContain(mutatedLabel);
      expect(result.requiresHandoff).toBe(false);
      expect(result.fallbackReason).toBe(fallbackReason);
      expect(result.violations).toEqual(
        fallbackReason === "composer_error" ? [] : ["unauthorized_price"],
      );
      expect(executionInput.composerInput.actionResult.slots[0]!.label).toBe(originalLabel);
    },
  );

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

type OrchestratorResponsePlanInput = {
  composerInput: ComposerInput;
  planInput: Omit<BuildResponsePlanInput, "actionResult">;
  turnId: string;
  clinicId: string;
  conversationId: string;
  safetyHandoffGuard?: TurnSafetyHandoffGuard;
  onRequiresHandoff: (reason: string) => Promise<void>;
};

type OrchestratorPlannerInternals = {
  responsePlanner: ConversationResponsePlanner;
  executeResponsePlan(input: OrchestratorResponsePlanInput): Promise<PlannedResponse>;
};

describe("ConversationOrchestrator response planner integration", () => {
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "test-response-planner-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("preserva a injeção do planner para todos os caminhos de composição", () => {
    const responsePlanner = new ConversationResponsePlanner({
      compose: async () => composed("Resposta autorizada"),
    });
    const orchestrator = new orchestratorModule.ConversationOrchestrator({
      responsePlanner,
    });

    expect(
      (orchestrator as unknown as OrchestratorPlannerInternals).responsePlanner,
    ).toBe(responsePlanner);
  });

  it("preserva response e registra somente contagens e códigos no caminho válido", async () => {
    const response = {
      ...composed("Resposta autorizada"),
      parts: [
        { type: "text" as const, content: "Resposta autorizada" },
        { type: "media" as const, id: "media-allowed" },
      ],
      mediaIds: ["media-allowed"],
      model: "planner-model",
      inputTokens: 17,
      outputTokens: 9,
    };
    const sink = new InMemoryDecisionTraceSink();
    const responsePlanner = new ConversationResponsePlanner({ compose: async () => response });
    const orchestrator = new orchestratorModule.ConversationOrchestrator({
      decisionTraceSink: sink,
      responsePlanner,
    });
    const internal = orchestrator as unknown as OrchestratorPlannerInternals;

    const planned = await internal.executeResponsePlan({
      composerInput: validComposerInput,
      planInput: {
        commercialPolicy: "Política privada R$ 1.234,00",
        installmentTable: null,
        allowedMediaIds: ["media-allowed"],
        expectedState: "idle",
        maxCharacters: 600,
      },
      turnId: "turn-valid",
      clinicId: "clinic-1",
      conversationId: "conversation-1",
      onRequiresHandoff: vi.fn(),
    });

    expect(planned.response).toBe(response);
    expect(sink.getEvents("turn-valid")).toEqual([
      expect.objectContaining({
        stage: "response.plan_built",
        metadata: {
          action: "general_question",
          planVersion: "response-plan.v1",
          allowedPriceCount: 1,
          allowedScheduleFactCount: 0,
          allowedMediaCount: 1,
          maxCharacters: 600,
          expectedState: "idle",
        },
      }),
      expect.objectContaining({
        stage: "response.validated",
        metadata: {
          action: "general_question",
          valid: true,
          violationCount: 0,
          requiresHandoff: false,
        },
      }),
    ]);
  });

  it("aplica fallback, sinaliza atenção e não vaza entradas sensíveis no trace", async () => {
    const sensitiveProviderText = "provider-private-timeout";
    const sensitivePolicy = "policy-private R$ 1.234,00";
    const sensitiveMediaId = "media-private-id";
    const sink = new InMemoryDecisionTraceSink();
    const responsePlanner = new ConversationResponsePlanner({
      compose: async () => composed(`Custa R$ 9.999,00 ${sensitiveProviderText}`),
    });
    const orchestrator = new orchestratorModule.ConversationOrchestrator({
      decisionTraceSink: sink,
      responsePlanner,
    });
    const internal = orchestrator as unknown as OrchestratorPlannerInternals;
    const onRequiresHandoff = vi.fn(async () => undefined);

    const planned = await internal.executeResponsePlan({
      composerInput: validComposerInput,
      planInput: {
        commercialPolicy: sensitivePolicy,
        installmentTable: "12x de R$ 102,83",
        allowedMediaIds: [sensitiveMediaId],
        expectedState: "awaiting_preference",
        maxCharacters: 600,
      },
      turnId: "turn-fallback",
      clinicId: "clinic-1",
      conversationId: "conversation-1",
      onRequiresHandoff,
    });

    expect(planned).toMatchObject({
      source: "deterministic_fallback",
      violations: ["unauthorized_price"],
      requiresHandoff: true,
      fallbackReason: "response_plan_violation",
    });
    expect(onRequiresHandoff).toHaveBeenCalledOnce();
    expect(onRequiresHandoff).toHaveBeenCalledWith(
      "Resposta segura requer revisão humana",
    );
    expect(sink.getEvents("turn-fallback").map((event) => ({
      stage: event.stage,
      metadata: event.metadata,
    }))).toEqual([
      {
        stage: "response.plan_built",
        metadata: {
          action: "general_question",
          planVersion: "response-plan.v1",
          allowedPriceCount: 2,
          allowedScheduleFactCount: 0,
          allowedMediaCount: 1,
          maxCharacters: 600,
          expectedState: "awaiting_preference",
        },
      },
      {
        stage: "response.validated",
        metadata: {
          action: "general_question",
          valid: false,
          violationCount: 1,
          requiresHandoff: true,
        },
      },
      {
        stage: "response.fallback_applied",
        metadata: {
          action: "general_question",
          fallbackReason: "response_plan_violation",
          requiresHandoff: true,
        },
      },
    ]);
    const serializedTrace = JSON.stringify(sink.getEvents("turn-fallback"));
    expect(serializedTrace).not.toContain(sensitiveProviderText);
    expect(serializedTrace).not.toContain(sensitivePolicy);
    expect(serializedTrace).not.toContain(sensitiveMediaId);
    expect(serializedTrace).not.toContain("9.999");
    expect(serializedTrace).not.toContain("102,83");
  });

  it.each([
    ["concisa", 280],
    ["equilibrada", 600],
    ["detalhada", 1_200],
    [undefined, 600],
  ] as const)("mapeia verbosidade %s para %i caracteres", (verbosity, expected) => {
    expect(orchestratorModule.resolveResponseMaxCharacters(verbosity)).toBe(expected);
  });

  it.each([
    "needs_human",
    "clinical_urgency",
    "unclear_threshold",
  ])(
    "mantém o handoff seguro sem duplicar efeitos quando %s roda depois da composição",
    async (laterPath) => {
      const responsePlanner = new ConversationResponsePlanner({
        compose: async () => composed("Custa R$ 9.999,00"),
      });
      const orchestrator = new orchestratorModule.ConversationOrchestrator({
        responsePlanner,
      });
      const internal = orchestrator as unknown as OrchestratorPlannerInternals;
      const attentionEffects: string[] = [];
      const guard = new TurnSafetyHandoffGuard();

      await internal.executeResponsePlan({
        composerInput: validComposerInput,
        planInput: {
          commercialPolicy: null,
          installmentTable: null,
          allowedMediaIds: [],
          expectedState: "none",
          maxCharacters: 600,
        },
        turnId: `turn-${laterPath}`,
        clinicId: "clinic-1",
        conversationId: "conversation-1",
        safetyHandoffGuard: guard,
        onRequiresHandoff: async (reason) => {
          attentionEffects.push(`update:${reason}`, `notify:${reason}`);
        },
      });
      await guard.applyLaterHandoff(async () => {
        attentionEffects.push(`update:${laterPath}`, `notify:${laterPath}`);
      });

      expect(attentionEffects).toEqual([
        "update:Resposta segura requer revisão humana",
        "notify:Resposta segura requer revisão humana",
      ]);
    },
  );

  it("preserva o handoff normal quando não existe revisão segura no turno", async () => {
    const attentionEffects: string[] = [];
    const guard = new TurnSafetyHandoffGuard();

    const applied = await guard.applyLaterHandoff(async () => {
      attentionEffects.push("update:needs_human", "notify:needs_human");
    });

    expect(applied).toBe(true);
    expect(attentionEffects).toEqual([
      "update:needs_human",
      "notify:needs_human",
    ]);
  });

  it("alinha exatamente a biblioteca filtrada de mídia entre composer e plano", () => {
    const editorialLibrary = [
      {
        id: "media-general",
        title: "Apresentação da clínica",
        type: "video" as const,
        treatmentId: null,
      },
      {
        id: "media-treatment",
        title: "Resultado do tratamento",
        type: "image" as const,
        treatmentId: "treatment-1",
      },
    ];
    const filtered = orchestratorModule.filterMediaLibraryForComposer(
      editorialLibrary,
      null,
      { type: "media_received", mediaType: "image" },
    );

    const projection = orchestratorModule.buildAlignedResponseMediaProjection(filtered);

    expect(projection.composerMediaLibrary).toBe(filtered);
    expect(projection.composerMediaLibrary).toEqual([
      editorialLibrary[0],
      editorialLibrary[1],
    ]);
    expect(projection.allowedMediaIds).toEqual([
      "media-general",
      "media-treatment",
    ]);
    expect(projection.allowedMediaIds).toEqual(
      projection.composerMediaLibrary.map((media) => media.id),
    );
  });
});
