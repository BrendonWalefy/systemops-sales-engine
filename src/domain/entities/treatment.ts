// ─── Pipeline de conversa por tratamento ─────────────────────────────────────
//
// Um pipeline define a SEQUÊNCIA de momentos que a IA conduz para um tratamento
// específico. Tratamentos sem pipeline continuam no modo reativo (comportamento atual).
//
// DECISÕES DE DESIGN (perguntas abertas marcadas com ⚠️):
//
//   1. ESCOPO: pipeline fica no treatment, que já é scoped por clinicId.
//      Duas clínicas com "Lentes" terão rows separados — sem conflito. ✅
//
//   2. ⚠️ EXIT CONDITION do step "qa": intent-based por padrão —
//      quando o lead expressar check_availability ou book_appointment, o pipeline
//      sai e o fluxo normal assume. maxTurns é um escape (padrão 10) para casos
//      em que o lead nunca expressa intenção explícita.
//      PENDENTE: avaliar se maxTurns deve virar configuração de clínica.
//
//   3. ⚠️ LEAD PULA ETAPAS: se o lead diz "quero agendar quinta" mid-Q&A,
//      o pipeline sai imediatamente e o fluxo de booking assume.
//      O pipeline é um guia, não uma prisão. Não bloqueia intenção real.
//
//   4. ⚠️ STEP "photo" — intercept de mídia: a ENTREGA do pedido de foto
//      está implementada. O INTERCEPT do inbound (detectar que a foto chegou
//      e avançar o pipeline) está pendente para v2 — requer mudança no caminho
//      de mídia do Orchestrator que hoje pausa a IA. Por ora, quando a foto
//      chega o operador é notificado e retoma o controle manualmente.
//
//   5. FALLBACK: treatments sem pipelineSteps continuam exatamente como hoje.
//      Zero alteração de comportamento para fluxo existente.

export type ContentBlock =
  | { kind: "text"; content: string }
  | { kind: "media"; mediaId: string };

export type PipelineStep =
  | {
      type: "content";
      label: string;
      // Blocos entregues em mensagens separadas: texto, vídeo, texto, vídeo...
      blocks: ContentBlock[];
    }
  | {
      type: "qa";
      label: string;
      // Instrução adicional para o LLM neste momento da conversa.
      // Ex: "Fique à disposição para dúvidas sobre as técnicas. Não mencione preços."
      instruction?: string;
      // Quantas mensagens de Q&A antes de sinalizar ao lead que pode agendar.
      // ⚠️ OPEN: deve ser configurável por clínica ou só por step?
      maxTurns?: number; // default 10
    }
  | {
      type: "photo";
      label: string;
      // Mensagem enviada ao lead pedindo a foto.
      message: string;
      // Se true, bloqueia avanço para agendamento até foto recebida.
      // ⚠️ OPEN (v2): o intercept do inbound ainda não está implementado.
      required: boolean;
    }
  | { type: "ask_availability"; label: string }
  | { type: "offer_slots"; label: string }
  | { type: "book"; label: string };

// ─────────────────────────────────────────────────────────────────────────────

export type Treatment = {
  id: string;
  clinicId: string;
  name: string;
  durationMinutes: number;
  description: string | null;
  commonObjections: string[];
  requiresEvaluationFirst: boolean;
  triggerTemplate: string | null;
  keywordMatchEnabled: boolean;
  aliases: string[];
  isAesthetic: boolean;
  pipelineSteps: PipelineStep[] | null;
  createdAt: Date;
  updatedAt: Date;
};
