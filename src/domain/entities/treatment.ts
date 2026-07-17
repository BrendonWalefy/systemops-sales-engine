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
  | { kind: "media"; mediaId: string; caption?: string };

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
      // Mídia anexada DETERMINISTICAMENTE quando a mensagem do lead casa com
      // alguma das palavras-chave (o sistema anexa, a LLM verbaliza). Ex.:
      // pergunta de "cor/tom" durante a Q&A de lentes → anexa a tabela de
      // cores. Sem isto o envio da imagem dependia da discrição do LLM (que
      // nesse ponto do fluxo não tem como anexar mídia — ver Orchestrator),
      // logo a imagem nunca ia junto. A mídia segue o isolamento por
      // procedimento (GERAL = enviável em qualquer contexto). Primeira entrada
      // que casa vence; ausente = comportamento atual (nenhum anexo).
      mediaOnKeywords?: { keywords: string[]; mediaId: string }[];
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

// Preço por quantidade fechada (ex.: pacotes de lentes: 10 = R$1.500, 20 = R$1.800).
// Existe porque clínicas vendem "pacotes" cujo preço NÃO é proporcional à quantidade
// — a IA não pode extrapolar (10 não é metade de 20). `scope` distingue a arcada quando
// o preço muda ("só as de cima"). Regra de ouro: só cotamos quantidades presentes nesta
// tabela; qualquer outra vira escalonamento para a equipe (nunca chutar um valor).
export type TreatmentQuantityPrice = {
  quantity: number;
  scope?: "total" | "superior" | "inferior";
  priceCents: number;
};

// Janela de INÍCIO permitida para agendar este tratamento (ex.: lentes só começam
// 09:00 e 16:00). Quando o tratamento tem janelas, os únicos horários ofertáveis são
// exatamente estes — a grade horária de 60min do businessHours é ignorada para ele.
// `weekdays` (0=Dom..6=Sáb) restringe os dias; ausente = todos os dias de operação da
// clínica. O FIM do slot pode ultrapassar o fim do expediente: a janela é config mais
// específica e vence (sem isso, lentes de 300min às 16:00 nunca seriam ofertáveis).
export type TreatmentBookingWindow = {
  startHour: number;   // 0-23
  startMinute: number; // 0-59
  weekdays?: number[];
};

export type Treatment = {
  id: string;
  clinicId: string;
  name: string;
  durationMinutes: number;
  description: string | null;
  requiresEvaluationFirst: boolean;
  keywordMatchEnabled: boolean;
  aliases: string[];
  isAesthetic: boolean;
  pipelineSteps: PipelineStep[] | null;
  priceCents: number | null;
  minPriceCents: number | null;
  maxPriceCents: number | null;
  // Item 3 (config ownership): a prosa de preço da IA é DERIVADA destes campos
  // estruturados (composePriceSection), nunca redigitada na commercialPolicy.
  priceQuotableInChat: boolean;
  priceKind: "from" | "fixed";
  priceUnit: string | null;
  priceDeductible: boolean;
  // Tabela de preço por quantidade fechada (pacotes). Ausente/null = sem pacotes por
  // quantidade (comportamento atual: só priceCents/minPriceCents). Opcional para não
  // exigir o campo em todo construtor de Treatment — o repositório sempre popula.
  quantityPrices?: TreatmentQuantityPrice[] | null;
  // Janelas de início permitidas. Ausente/null = grade horária padrão (businessHours).
  bookingWindows?: TreatmentBookingWindow[] | null;
  createdAt: Date;
  updatedAt: Date;
};
