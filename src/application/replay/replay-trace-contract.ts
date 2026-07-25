type ReplayTraceRecord = {
  turnId: string;
  stage: string;
  metadata?: Readonly<Record<string, string | number | boolean | null>>;
};

/**
 * Um turno completo termina em exatamente um dos caminhos:
 * resposta enfileirada/entregue ou silêncio intencional explicado.
 */
export function isReplayTurnTraceComplete(
  traces: ReplayTraceRecord[],
  turnId: string,
): boolean {
  const turnTraces = traces.filter((trace) => trace.turnId === turnId);
  const stages = new Set(turnTraces.map((trace) => trace.stage));
  const baseStages = [
    "ingress.received",
    "orchestrator.started",
    "orchestrator.completed",
  ];
  if (!baseStages.every((stage) => stages.has(stage))) return false;

  const completion = turnTraces.find(
    (trace) => trace.stage === "orchestrator.completed",
  );
  if (completion?.metadata?.replied === false) {
    return (
      stages.has("turn.ignored") &&
      !stages.has("outbound.enqueued") &&
      !stages.has("delivery.sent")
    );
  }

  return [
    "state.loaded",
    "intent.classified",
    "intent.resolved",
    "outbound.enqueued",
    "delivery.sent",
  ].every((stage) => stages.has(stage));
}
