import type {
  ReplayBugV1,
  ReplayScenarioTurnV1,
  ReplayScenarioV1,
} from "@/application/replay/contracts";
import type { ReplayCalendarEffect } from "@/application/replay/replay-calendar-capture";
import type { ReplayOutboundEffect } from "@/application/replay/replay-outbound-capture";
import {
  extractAllReferencedPrices,
  formatReferencedPrice,
} from "@/core/intelligence/price-reference";
import type { DecisionTraceEventV1 } from "@/core/observability/DecisionTrace";

/**
 * O que o lead recebeu na época, venha do agente ou da recepcionista humana.
 * Em Vitalli e NC Beauty a maioria das respostas históricas é de operador, e é
 * contra elas que o sistema de hoje precisa ser comparado.
 */
export type ReplayHistoricalReply = {
  turns: ReplayScenarioTurnV1[];
};

export type ReplayReplayedReply = {
  outboundEffects: ReplayOutboundEffect[];
  calendarEffects: ReplayCalendarEffect[];
  trace: DecisionTraceEventV1[];
};

export type ReplayDivergenceInput = {
  scenarioId: string;
  leadTurnId: string;
  historical: ReplayHistoricalReply;
  replayed: ReplayReplayedReply;
};

/**
 * Compara um turno replayado contra a resposta que o lead recebeu na época e
 * devolve as divergências. Cada dimensão é independente e determinística —
 * nenhuma chamada de LLM. Divergência é candidata a bug, não veredito: onde as
 * duas respostas forem plausíveis, quem decide é o judge de prosa da Fase C.
 */
export function detectReplayDivergences(
  input: ReplayDivergenceInput,
): ReplayBugV1[] {
  return [
    ...detectPriceDivergences(input),
    ...detectMediaDivergences(input),
    ...detectHandoffDivergences(input),
    ...detectCalendarDivergences(input),
  ].map((bug) => ({ ...bug, turnId: input.leadTurnId }));
}

/**
 * Compara só o que o corpus sanitizado permite. Ele carrega turnos, não o
 * desfecho: não há como saber se a conversa histórica terminou em agendamento,
 * então "agendou onde não agendou" fica de fora até o exportador gravar o
 * desfecho. O que é verificável sem verdade-base é a escrita dupla — um turno
 * nunca deve criar dois agendamentos, tenha o histórico agendado ou não.
 */
function detectCalendarDivergences(input: ReplayDivergenceInput): ReplayBugV1[] {
  const created = input.replayed.calendarEffects.filter(
    (effect) => effect.kind === "appointment.create",
  );
  if (created.length < 2) return [];

  return [{
    code: "calendar_double_write",
    severity: "critical",
    title: `Um único turno criou ${created.length} agendamentos`,
    evidenceStages: ["response.plan_built", "state.pipeline_committed"],
    probableOwner: "concurrency",
  }];
}

/**
 * Só a direção regressão: o agente resolvia sozinho e hoje o sistema escala.
 *
 * A direção inversa — humano respondia e hoje o sistema responde sozinho — é a
 * norma no histórico de Vitalli e NC Beauty, onde o operador escreveu 314 e 470
 * turnos contra 85 e 52 do agente. Tratá-la como divergência afogaria a lista
 * em achados que só dizem "a IA estava desligada na época".
 */
function detectHandoffDivergences(input: ReplayDivergenceInput): ReplayBugV1[] {
  const replayEscalated = input.replayed.trace.some(
    (event) => event.metadata?.requiresHandoff === true,
  );
  if (!replayEscalated) return [];

  const agentResolvedAlone =
    input.historical.turns.some((turn) => turn.author === "agent") &&
    !input.historical.turns.some((turn) => turn.author === "operator");
  if (!agentResolvedAlone) return [];

  return [{
    code: "handoff_regression",
    severity: "high",
    title: "Agente resolvia sozinho no histórico e o replay escalou para humano",
    evidenceStages: ["intent.resolved", "response.validated", "response.fallback_applied"],
    probableOwner: "prompt_or_model",
  }];
}

function detectPriceDivergences(input: ReplayDivergenceInput): ReplayBugV1[] {
  const historical = collectPrices(historicalTexts(input.historical));
  const replayed = collectPrices(replayedTexts(input.replayed));
  if (historical.length === 0) return [];

  const unexpected = replayed.filter((cents) => !historical.includes(cents));
  if (unexpected.length > 0) {
    return [{
      code: "price_value_divergence",
      severity: "high",
      title:
        `Replay cotou ${formatCentsList(unexpected)} onde o histórico ` +
        `cotou ${formatCentsList(historical)}`,
      evidenceStages: ["response.plan_built", "response.validated"],
      probableOwner: "clinic_config",
    }];
  }

  if (replayed.length === 0) {
    return [{
      code: "price_omitted",
      severity: "high",
      title:
        `Histórico cotou ${formatCentsList(historical)} e o replay não ` +
        "citou valor nenhum",
      evidenceStages: ["response.plan_built", "response.validated"],
      probableOwner: "deterministic_code",
    }];
  }

  return [];
}

function detectMediaDivergences(input: ReplayDivergenceInput): ReplayBugV1[] {
  const bugs: ReplayBugV1[] = [];
  const replayedRefs = input.replayed.outboundEffects.flatMap((effect) =>
    effect.kind === "media" ? [effect.mediaRef] : [],
  );

  const repeated = new Set(
    replayedRefs.filter((ref, index) => replayedRefs.indexOf(ref) !== index),
  );
  if (repeated.size > 0) {
    bugs.push({
      code: "media_repeated",
      severity: "critical",
      title:
        `Replay entregou o mesmo anexo mais de uma vez (${repeated.size} ` +
        "asset(s) repetido(s)) no mesmo turno",
      evidenceStages: ["response.plan_built", "outbound.planned", "delivery.sent"],
      probableOwner: "deterministic_code",
    });
  }

  // Quem anexou na época decide o peso do achado. Anexo da IA que sumiu é
  // regressão. Anexo que só o operador humano mandava nunca foi comportamento
  // da IA — cobrar isso dela infla a lista: na Ximendes, 17 das 23 respostas
  // com anexo tinham operador envolvido.
  const attachments = input.historical.turns.filter(
    (turn) => turn.author !== "lead" && turn.content.type !== "text",
  );
  const fromAgent = attachments.filter((turn) => turn.author === "agent");
  const fromOperatorOnly = attachments.length > 0 && fromAgent.length === 0;

  if (replayedRefs.length === 0 && fromAgent.length > 0) {
    bugs.push({
      code: "media_omitted",
      severity: "high",
      title:
        `Histórico entregou ${fromAgent.length} anexo(s) da IA ` +
        `(${listAttachmentTypes(fromAgent)}) e o replay respondeu só com texto`,
      evidenceStages: ["response.plan_built", "outbound.planned"],
      probableOwner: "deterministic_code",
    });
  }

  if (replayedRefs.length === 0 && fromOperatorOnly) {
    bugs.push({
      code: "media_handled_by_operator",
      severity: "low",
      title:
        `Só o operador entregava anexo aqui (${listAttachmentTypes(attachments)}) — ` +
        "lacuna de biblioteca ou de passo de pipeline, não regressão da IA",
      evidenceStages: ["response.plan_built"],
      probableOwner: "clinic_config",
    });
  }

  return bugs;
}

function listAttachmentTypes(turns: ReplayScenarioTurnV1[]): string {
  return [...new Set(turns.map((turn) => turn.content.type))].join(", ");
}

/** Um grupo de turnos drenado junto, com os efeitos que ele produziu. */
export type ReplayScenarioRun = {
  scenarioTurnIds: string[];
  outboundEffects: ReplayOutboundEffect[];
  calendarEffects: ReplayCalendarEffect[];
};

/**
 * Percorre o cenário emparelhando cada grupo executado com a resposta que a
 * clínica deu na época ao mesmo turno. Turno que ninguém respondeu é pulado:
 * silêncio histórico não é verdade-base para comparar contra.
 */
export function detectReplayScenarioDivergences(input: {
  scenario: ReplayScenarioV1;
  runs: ReplayScenarioRun[];
  trace: DecisionTraceEventV1[];
}): ReplayBugV1[] {
  return input.runs.flatMap((run) => {
    // Em modo concurrency o grupo traz uma rajada; a resposta histórica é a que
    // veio depois do último turno dela.
    const leadTurnId = run.scenarioTurnIds.at(-1);
    if (!leadTurnId) return [];

    const turns = historicalReplyTo(input.scenario, leadTurnId);
    if (turns.length === 0) return [];

    return detectReplayDivergences({
      scenarioId: input.scenario.id,
      leadTurnId,
      historical: { turns },
      replayed: {
        outboundEffects: run.outboundEffects,
        calendarEffects: run.calendarEffects,
        trace: input.trace,
      },
    });
  });
}

/** Turnos não-lead entre este turno do lead e o próximo turno do lead. */
function historicalReplyTo(
  scenario: ReplayScenarioV1,
  leadTurnId: string,
): ReplayScenarioTurnV1[] {
  const index = scenario.turns.findIndex((turn) => turn.id === leadTurnId);
  if (index < 0) return [];

  const reply: ReplayScenarioTurnV1[] = [];
  for (const turn of scenario.turns.slice(index + 1)) {
    if (turn.author === "lead") break;
    reply.push(turn);
  }
  return reply;
}

/** O que o lead leu na época — turnos do agente e do operador, nunca do lead. */
function historicalTexts(historical: ReplayHistoricalReply): string[] {
  return historical.turns
    .filter((turn) => turn.author !== "lead")
    .map((turn) => turn.content.text);
}

/** O que o sistema de hoje teria entregue, incluindo legenda de mídia. */
function replayedTexts(replayed: ReplayReplayedReply): string[] {
  return replayed.outboundEffects.flatMap((effect) => {
    if (effect.kind === "media") return effect.caption ? [effect.caption] : [];
    return [effect.content];
  });
}

function collectPrices(texts: string[]): number[] {
  return [...new Set(texts.flatMap(extractAllReferencedPrices))];
}

function formatCentsList(cents: number[]): string {
  return cents.map(formatReferencedPrice).join(" e ");
}
