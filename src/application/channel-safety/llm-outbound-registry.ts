/**
 * Registro declarado dos caminhos em que texto de modelo pode alcançar um canal
 * externo. É o contraponto humano de `llm-outbound-graph.ts`: o grafo descobre,
 * o registro decide. Caminho novo que o grafo encontre e o registro não declare
 * quebra o CI — a decisão passa a ser explícita e visível no diff.
 *
 * Classificações:
 *
 * - `autonomous_external`: o sistema envia sozinho ao lead. **Obrigatoriamente**
 *   atravessa plano → gerador → validador → fallback, direto pelo
 *   `ConversationResponsePlanner` ou delegando ao `ConversationOrchestrator`,
 *   que o usa.
 * - `human_approved_external`: o modelo redige, uma pessoa aprova antes de sair.
 *   Provado por teste em `LlmOutboundHumanGate.test.ts`.
 * - `transport_only`: entrega o que a outbox já carrega. Não gera texto e não
 *   escolhe conteúdo — o conteúdo já passou pela fronteira antes de chegar aqui.
 * - `no_llm_text`: o grafo alcança um pacote de modelo por import de tipo ou de
 *   hub, mas o texto enviado é template determinístico. Falso positivo do
 *   alcance por imports, mantido declarado em vez de silenciado.
 * - `internal_only`: não alcança lead nenhum.
 */
export type LlmOutboundClassification =
  | "autonomous_external"
  | "human_approved_external"
  | "transport_only"
  | "no_llm_text"
  | "internal_only";

export type LlmOutboundDeclaration = {
  classification: LlmOutboundClassification;
  reason: string;
  /**
   * Só para `autonomous_external`: como a fronteira é alcançada. `planner` = o
   * módulo importa `ConversationResponsePlanner`. `orchestrator` = delega para
   * o `ConversationOrchestrator`, que a aplica por dentro.
   */
  boundary?: "planner" | "orchestrator";
  /**
   * `true` quando o caminho não é descoberto pelo grafo de imports e só existe
   * aqui. Hoje: texto que viaja pelo banco entre a geração e o envio.
   */
  manualOnly?: boolean;
};

export const LLM_OUTBOUND_REGISTRY: Record<string, LlmOutboundDeclaration> = {
  "core/pipeline/ConversationOrchestrator": {
    classification: "autonomous_external",
    reason: "Turno principal da conversa: resposta ao lead no WhatsApp.",
    boundary: "planner",
  },
  "app/api/cron/appointment-reminder/route": {
    classification: "autonomous_external",
    reason: "Lembrete de consulta, cron diário.",
    boundary: "planner",
  },
  "app/api/cron/follow-up-dispatcher/route": {
    classification: "autonomous_external",
    reason: "Follow-up de reengajamento, cron.",
    boundary: "planner",
  },
  "app/api/cron/recovery-campaign/route": {
    classification: "autonomous_external",
    reason: "Retomada de conversa sem resposta, cron 2x/dia.",
    boundary: "planner",
  },
  "app/api/conversations/[conversationId]/pipeline-actions/route": {
    classification: "autonomous_external",
    reason:
      "Retomar a IA numa conversa dispara `orchestrator.handle`, cuja resposta vai ao lead.",
    boundary: "orchestrator",
  },
  "app/api/whatsapp/zapi/route": {
    classification: "autonomous_external",
    reason:
      "`resumeAfterHumanReviewDecision` continua o turno pelo orquestrador; o resto do arquivo envia texto determinístico de operação.",
    boundary: "orchestrator",
  },

  "app/(clinic)/app/inbox/recovery-actions": {
    classification: "human_approved_external",
    reason:
      "Duas Server Actions distintas: `composeRecoveryMessageAction` devolve o texto para a tela e não envia; `sendRecoveryMessageAction` envia o que o operador tem no campo, editável. Nenhum cron chama nenhuma das duas.",
  },
  "application/reactivation/dispatch-campaign": {
    classification: "human_approved_external",
    reason:
      "Rascunho gerado por LLM é gravado no banco e só sai com aprovação da campanha (`approvedAt`) e do alvo (`status='approved'`), ambas por ação humana no painel. Nenhum cron chama `dispatchCampaign`.",
    manualOnly: true,
  },

  "application/jobs/send-message-job": {
    classification: "transport_only",
    reason: "Entrega ao provider o payload que a outbox já carregava.",
  },
  "lib/tts-send": {
    classification: "transport_only",
    reason: "Converte em áudio e entrega texto já autorizado.",
  },

  "app/api/cron/post-appointment-followup/route": {
    classification: "no_llm_text",
    reason:
      "`renderPostAppointmentMessage` interpola uma regra cadastrada pela clínica; nenhuma chamada de modelo no caminho.",
  },
};

export function unprotectedAutonomousPaths(
  discovered: ReadonlyArray<{ module: string; usesPlanner: boolean }>,
): string[] {
  return discovered
    .filter((path) => {
      const declaration = LLM_OUTBOUND_REGISTRY[path.module];
      if (declaration?.classification !== "autonomous_external") return false;
      if (declaration.boundary === "orchestrator") return false;
      return !path.usesPlanner;
    })
    .map((path) => path.module);
}
