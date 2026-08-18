import { describe, expect, it } from "vitest";
import type { ReplayScenarioTurnV1, ReplayScenarioV1 } from "@/application/replay/contracts";
import {
  detectReplayDivergences,
  detectReplayScenarioDivergences,
} from "@/application/replay/detect-replay-divergences";
import type { ReplayCalendarEffect } from "@/application/replay/replay-calendar-capture";
import type { ReplayOutboundEffect } from "@/application/replay/replay-outbound-capture";
import type { DecisionTraceEventV1 } from "@/core/observability/DecisionTrace";

const historicalTurn = (
  text: string,
  overrides: Partial<ReplayScenarioTurnV1> = {},
): ReplayScenarioTurnV1 => ({
  id: "historical-1",
  author: "agent",
  offsetMs: 0,
  content: { type: "text", text },
  ...overrides,
});

const textEffect = (content: string, sequence = 1): ReplayOutboundEffect => ({
  sequence,
  kind: "text",
  to: "lead-phone",
  content,
  providerMessageId: `replay-capture-${sequence}`,
});

const mediaEffect = (
  mediaRef: string,
  sequence = 1,
  overrides: Partial<Extract<ReplayOutboundEffect, { kind: "media" }>> = {},
): ReplayOutboundEffect => ({
  sequence,
  kind: "media",
  to: "lead-phone",
  mediaType: "video",
  mediaRef,
  caption: null,
  fileName: null,
  providerMessageId: `replay-capture-${sequence}`,
  ...overrides,
});

const appointmentCreate = (sequence: number): ReplayCalendarEffect => ({
  sequence,
  kind: "appointment.create",
  clinicId: "clinic-1",
  leadId: "lead-1",
  startsAt: "2026-08-18T17:00:00.000Z",
  endsAt: "2026-08-18T17:30:00.000Z",
  title: "Avaliação",
  capturedEventId: `replay-calendar-${sequence}`,
});

const handoffTrace = (): DecisionTraceEventV1 => ({
  schemaVersion: "decision-trace.v1",
  sequence: 0,
  turnId: "lead-1",
  stage: "response.validated",
  occurredAt: "2026-08-13T12:00:00.000Z",
  metadata: { action: "needs_human", valid: true, violationCount: 0, requiresHandoff: true },
});

const detect = (input: {
  historicalTurns: ReplayScenarioTurnV1[];
  outboundEffects?: ReplayOutboundEffect[];
  calendarEffects?: ReplayCalendarEffect[];
  trace?: DecisionTraceEventV1[];
}) =>
  detectReplayDivergences({
    scenarioId: "scenario-1",
    leadTurnId: "lead-1",
    historical: { turns: input.historicalTurns },
    replayed: {
      outboundEffects: input.outboundEffects ?? [],
      calendarEffects: input.calendarEffects ?? [],
      trace: input.trace ?? [],
    },
  });

describe("detectReplayDivergences", () => {
  it("acusa preço divergente quando o replay cota valor diferente do histórico", () => {
    const bugs = detect({
      historicalTurns: [historicalTurn("A lente de contato fica R$ 2.000 por dente.")],
      outboundEffects: [textEffect("A lente de contato fica R$ 4.000 por dente.")],
    });

    expect(bugs).toContainEqual(
      expect.objectContaining({
        code: "price_value_divergence",
        severity: "high",
        probableOwner: "clinic_config",
      }),
    );
  });

  it("não acusa nada quando o replay repete o valor do histórico", () => {
    const bugs = detect({
      historicalTurns: [historicalTurn("A lente de contato fica R$ 2.000 por dente.")],
      outboundEffects: [textEffect("O valor da lente de contato é R$ 2.000 por dente.")],
    });

    expect(bugs).toEqual([]);
  });

  it("acusa preço omitido quando o histórico cotou e o replay não cita valor", () => {
    const bugs = detect({
      historicalTurns: [historicalTurn("A lente de contato fica R$ 2.000 por dente.")],
      outboundEffects: [textEffect("Vou verificar com a equipe e já te retorno.")],
    });

    expect(bugs).toContainEqual(
      expect.objectContaining({
        code: "price_omitted",
        severity: "high",
        probableOwner: "deterministic_code",
      }),
    );
  });

  it("acusa mídia repetida quando o replay envia o mesmo anexo duas vezes", () => {
    const bugs = detect({
      historicalTurns: [
        historicalTurn("", { content: { type: "video", text: "[video]" } }),
      ],
      outboundEffects: [mediaEffect("asset-a", 1), mediaEffect("asset-a", 2)],
    });

    expect(bugs).toContainEqual(
      expect.objectContaining({
        code: "media_repeated",
        severity: "critical",
        probableOwner: "deterministic_code",
      }),
    );
  });

  it("acusa mídia ausente quando o histórico anexou e o replay só mandou texto", () => {
    const bugs = detect({
      historicalTurns: [
        historicalTurn("", { content: { type: "image", text: "[imagem]" } }),
      ],
      outboundEffects: [textEffect("Te explico por aqui mesmo.")],
    });

    expect(bugs).toContainEqual(
      expect.objectContaining({
        code: "media_omitted",
        severity: "high",
        probableOwner: "deterministic_code",
      }),
    );
  });

  it("não acusa mídia ausente quando quem anexou foi o operador, não a IA", () => {
    // Recepcionista humana mandando foto na mão não é comportamento que a IA
    // devia replicar. Comparar contra isso infla a lista com falso positivo:
    // na Ximendes, 17 das 23 respostas com anexo tinham operador envolvido.
    const bugs = detect({
      historicalTurns: [
        historicalTurn("", {
          author: "operator",
          content: { type: "image", text: "[imagem]" },
        }),
      ],
      outboundEffects: [textEffect("Te explico por aqui mesmo.")],
    });

    expect(bugs.map((bug) => bug.code)).not.toContain("media_omitted");
  });

  it("registra em severidade baixa que só o operador dava conta do anexo", () => {
    // Sinal de lacuna de produto (a IA não tinha o asset), não de regressão.
    const bugs = detect({
      historicalTurns: [
        historicalTurn("", {
          author: "operator",
          content: { type: "image", text: "[imagem]" },
        }),
      ],
      outboundEffects: [textEffect("Te explico por aqui mesmo.")],
    });

    expect(bugs).toContainEqual(
      expect.objectContaining({
        code: "media_handled_by_operator",
        severity: "low",
        probableOwner: "clinic_config",
      }),
    );
  });

  it("não acusa mídia ausente quando o histórico também foi só texto", () => {
    const bugs = detect({
      historicalTurns: [historicalTurn("Claro, pode vir terça às 14h.")],
      outboundEffects: [textEffect("Perfeito, terça às 14h está reservado.")],
    });

    expect(bugs).toEqual([]);
  });

  it("acusa regressão de handoff quando o agente resolvia sozinho e o replay escala", () => {
    const bugs = detect({
      historicalTurns: [historicalTurn("Atendemos das 9h às 18h, pode vir sem agendar.")],
      outboundEffects: [textEffect("Vou chamar alguém da equipe para te ajudar.")],
      trace: [handoffTrace()],
    });

    expect(bugs).toContainEqual(
      expect.objectContaining({
        code: "handoff_regression",
        severity: "high",
        probableOwner: "prompt_or_model",
      }),
    );
  });

  it("carimba o turno do lead que originou a divergência", () => {
    const bugs = detect({
      historicalTurns: [historicalTurn("A lente de contato fica R$ 2.000 por dente.")],
      outboundEffects: [textEffect("A lente de contato fica R$ 4.000 por dente.")],
    });

    expect(bugs[0]?.turnId).toBe("lead-1");
  });

  it("acusa escrita dupla no calendário quando um turno cria dois agendamentos", () => {
    const bugs = detect({
      historicalTurns: [historicalTurn("Marcado para terça às 14h.")],
      outboundEffects: [textEffect("Marcado para terça às 14h.")],
      calendarEffects: [appointmentCreate(1), appointmentCreate(2)],
    });

    expect(bugs).toContainEqual(
      expect.objectContaining({
        code: "calendar_double_write",
        severity: "critical",
        probableOwner: "concurrency",
      }),
    );
  });

  it("não acusa escrita dupla quando o turno cria um agendamento só", () => {
    const bugs = detect({
      historicalTurns: [historicalTurn("Marcado para terça às 14h.")],
      outboundEffects: [textEffect("Marcado para terça às 14h.")],
      calendarEffects: [appointmentCreate(1)],
    });

    expect(bugs).toEqual([]);
  });

  it("não acusa handoff quando quem respondeu na época já era humano", () => {
    const bugs = detect({
      historicalTurns: [
        historicalTurn("Deixa que eu confirmo isso com a doutora.", { author: "operator" }),
      ],
      outboundEffects: [textEffect("Vou chamar alguém da equipe para te ajudar.")],
      trace: [handoffTrace()],
    });

    expect(bugs).toEqual([]);
  });
});

const scenario = (turns: ReplayScenarioTurnV1[]): ReplayScenarioV1 => ({
  schemaVersion: "replay-scenario.v1",
  id: "scenario-1",
  datasetVersion: "v1",
  source: { kind: "historical", sourceRef: "hash", sanitized: true },
  clinic: { clinicKey: "ximendes", configFingerprint: "cfg", playbookFingerprint: "pb" },
  compatibleModes: ["closed_loop"],
  clock: { startedAt: "2026-08-13T12:00:00.000Z", timezone: "America/Sao_Paulo" },
  tags: ["historical"],
  turns,
});

const leadTurn = (id: string, offsetMs: number): ReplayScenarioTurnV1 => ({
  id,
  author: "lead",
  offsetMs,
  content: { type: "text", text: "quanto custa?" },
});

describe("detectReplayScenarioDivergences", () => {
  it("compara cada turno do lead contra a resposta histórica que veio depois dele", () => {
    const bugs = detectReplayScenarioDivergences({
      scenario: scenario([
        leadTurn("lead-1", 0),
        historicalTurn("A lente fica R$ 2.000 por dente.", { id: "h-1", offsetMs: 1_000 }),
        leadTurn("lead-2", 2_000),
        historicalTurn("Consigo terça às 14h.", { id: "h-2", offsetMs: 3_000 }),
      ]),
      runs: [
        {
          scenarioTurnIds: ["lead-1"],
          outboundEffects: [textEffect("A lente fica R$ 4.000 por dente.")],
          calendarEffects: [],
        },
        {
          scenarioTurnIds: ["lead-2"],
          outboundEffects: [textEffect("Consigo terça às 14h.")],
          calendarEffects: [],
        },
      ],
      trace: [],
    });

    expect(bugs).toHaveLength(1);
    expect(bugs[0]).toEqual(expect.objectContaining({
      code: "price_value_divergence",
      turnId: "lead-1",
    }));
  });

  it("ignora turno do lead que a clínica nunca respondeu", () => {
    const bugs = detectReplayScenarioDivergences({
      scenario: scenario([leadTurn("lead-1", 0), leadTurn("lead-2", 1_000)]),
      runs: [
        {
          scenarioTurnIds: ["lead-1"],
          outboundEffects: [textEffect("Bom dia! A lente fica R$ 4.000.")],
          calendarEffects: [],
        },
      ],
      trace: [],
    });

    expect(bugs).toEqual([]);
  });
});
