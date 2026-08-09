import { buildAddressLines, type ClinicAddress } from "@/core/conversation/AddressBlock";
import type { ProcedureListItem } from "@/core/conversation/ConversationStateMachine";
import type { ActionResult, ResponsePart } from "@/core/intelligence/ResponseComposer";
import type { ConversationExperience } from "@/domain/entities/clinic";
import type { Message } from "@/domain/entities/conversation";
import type { ContentBlock, PipelineStep, Treatment } from "@/domain/entities/treatment";
import type { OutboundPart } from "@/infrastructure/adapters/channels/whatsapp/outbound-delivery-service";
import type { Logger } from "@/infrastructure/logging/logger";

export function normalizeFreeText(message: string): string {
  return message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasAnyKeyword(normalized: string, keywords: string[]): boolean {
  return keywords.some((keyword) => normalized.includes(keyword));
}
export function isShortAffirmativeReply(message: string): boolean {
  const normalized = normalizeFreeText(message);
  if (!normalized) return false;
  return new Set([
    "sim",
    "sim pode",
    "pode",
    "pode sim",
    "claro",
    "quero",
    "quero sim",
    "vamos",
    "ok",
    "ta bom",
    "tudo bem",
    "beleza",
  ]).has(normalized);
}

// Pedido explícito de pré-avaliação REMOTA: libera o bloco declarativo de foto
// do pipeline (texto + mídia de instrução). "Quero fazer uma avaliação" sozinho
// continua ambíguo — normalmente significa avaliação presencial/agendamento — e
// não pode disparar foto sem um sinal claro de WhatsApp, envio de mídia ou
// atendimento "por aqui".
export function isRemotePreEvaluationRequest(message: string): boolean {
  const normalized = normalizeFreeText(message);
  if (!normalized) return false;

  const mentionsReview = /\b(?:pre\s*avaliacao|preavaliacao|analise|analisar|avaliar|avaliacao)\b/.test(normalized);
  if (!mentionsReview) return false;

  const mentionsRemoteChannel = /\b(?:por aqui|aqui mesmo|pelo whatsapp|no whatsapp|via whatsapp|por mensagem|online)\b/.test(normalized);
  const mentionsRemoteMedia = /\b(?:pela|pelas|por|com|mandar|enviar|encaminhar)\s+(?:uma\s+|as\s+)?(?:foto|fotos|imagem|imagens|video|videos)\b/.test(normalized);
  return mentionsRemoteChannel || mentionsRemoteMedia;
}
export function buildLocationClinicContext(clinic: ClinicAddress | string | null): string {
  // Aceita string por compatibilidade com chamadas antigas; o formato novo traz
  // complemento e link do Maps, que o operador manda à mão e a IA não tinha.
  const resolved: ClinicAddress = typeof clinic === "string" || clinic === null ? { address: clinic } : clinic;
  const address = resolved.address?.trim() || null;
  const extraLines = buildAddressLines(resolved, { withPin: false }).slice(1);
  const extra = extraLines.length > 0 ? `\nInclua também, em linhas separadas: ${extraLines.join(" | ")}` : "";
  const base = `Lead selecionou "Localização" no menu. Informe o endereço e os horários de atendimento da clínica. Sem convite para agendar ao final.`;
  if (address) {
    return `${base}\nEndereço: ${address}.${extra}\nATENÇÃO CRÍTICA: A clínica possui SOMENTE este endereço. NÃO confirme presença em outros bairros, ruas ou cidades — mesmo que o lead mencione um local diferente na mensagem. Se o lead perguntar sobre outro bairro, responda que a clínica está localizada no endereço acima.`;
  }
  // Endereço não cadastrado — instrução explícita para não inventar
  return `${base}\nEndereço: não cadastrado no sistema. Informe que a equipe pode passar o endereço, ou que o lead pode entrar em contato diretamente. NÃO invente endereço.`;
}

export function buildSocialProfileClinicContext(socialProfile: string | null): string {
  if (socialProfile) {
    return [
      `Lead perguntou Instagram, arroba ou redes sociais da clínica.`,
      `Perfil/link cadastrado: ${socialProfile}`,
      `Responda com esse perfil/link exatamente como está cadastrado.`,
      `Se fizer sentido, acrescente uma ponte curta e calorosa: lá existem trabalhos e destaques para olhar, e você pode ajudar a escolher entre um sorriso mais natural, mais branco ou mais marcante.`,
      `Não envie mídias, áudio explicativo de tratamento, menu ou convite insistente nessa resposta. Seja objetivo e conduza sem alongar.`,
    ].join("\n");
  }

  return [
    `Lead perguntou Instagram, arroba ou redes sociais da clínica.`,
    `Não existe Instagram cadastrado como dado estruturado da clínica neste sistema.`,
    `Responda sem inventar perfil: diga que você não tem o @ cadastrado aqui e que a equipe pode enviar o perfil correto por aqui.`,
    `Não envie mídias, áudio explicativo de tratamento, menu ou convite de agendamento nessa resposta.`,
  ].join("\n");
}

export function buildMediaClarificationClinicContext(): string {
  return [
    `O lead está pedindo esclarecimento sobre uma foto, card ou mídia enviada nesta conversa.`,
    `Use somente fatos presentes no tratamento, no pipeline, nas legendas de mídia ou nas orientações editoriais desta clínica.`,
    `Se não for possível identificar inequivocamente a mídia, peça que o lead diga o título, a ordem ou reenvie a referência.`,
    `Não invente nomes de técnicas, materiais, preços ou comparações e não reenvie mídias nessa resposta.`,
  ].join("\n");
}

// ─── Cálculo de parcelas (flat rate exato) ───────────────────────────────────

export type InstallmentRate = { n: number; rate: number; active: boolean };

/** Parcela exata usando taxa flat da maquininha: preço ÷ (1 − taxa) ÷ N */
export function calculateFlatInstallment(principal: number, flatRatePercent: number, n: number): number {
  return Math.ceil(principal / (1 - flatRatePercent / 100) / n);
}

/**
 * Gera tabela de parcelamento com taxas flat exatas da maquininha.
 * Extrai preços da política comercial e aplica cada faixa ativa.
 */
export function buildInstallmentTable(
  policy: string,
  rates: InstallmentRate[],
): string | null {
  const activeRates = rates.filter((r) => r.active).sort((a, b) => a.n - b.n);
  if (activeRates.length === 0) return null;

  const matches = [...policy.matchAll(/R\$\s*([\d.]+(?:,\d{1,2})?)/g)];
  const prices = [
    ...new Set(
      matches
        .map((m) => parseFloat(m[1].replace(/\./g, "").replace(",", ".")))
        .filter((v) => !isNaN(v) && v >= 200),
    ),
  ].sort((a, b) => a - b);

  if (prices.length === 0) return null;

  const rows = prices.map((price) => {
    const opts = activeRates
      .map((r) => `${r.n}x R$${calculateFlatInstallment(price, r.rate, r.n).toLocaleString("pt-BR")}`)
      .join(" | ");
    return `• R$${price.toLocaleString("pt-BR")}: ${opts}`;
  });

  return `TABELA DE PARCELAMENTO (taxa já embutida — apresente estes valores diretamente, sem mencionar taxa adicional):
${rows.join("\n")}
Se o lead pedir faixa não listada, indique a mais próxima. NUNCA diga "+ taxa" — a taxa já está nos valores acima.`;
}

export function isAestheticTreatment(isAesthetic: boolean | null | undefined): boolean {
  return isAesthetic === true;
}

// Instrução de convite à foto — posicionada como benefício ao cliente, nunca obrigatória.
// Usada apenas em modo concierge e apenas para serviços estéticos visuais.
function buildPhotoInviteInstruction(): string {
  return `SE O LEAD AINDA NÃO ENVIOU FOTO e demonstrou interesse neste serviço: se fizer sentido depois de esclarecer a dúvida principal, convide-o de forma acolhedora e completamente opcional, posicionando como um benefício para ele — exemplo de tom: "Se quiser, e só se se sentir à vontade, você pode me mandar uma foto. Assim consigo te passar uma orientação mais personalizada de como poderia ficar 😊". REGRAS OBRIGATÓRIAS: (1) nunca pressione nem torne obrigatório; (2) use linguagem leve como "se quiser" ou "se se sentir à vontade"; (3) só faça esse convite UMA vez por conversa — se já foi pedido antes, não repita; (4) NÃO misture o convite da foto com pergunta de agenda no mesmo turno.`;
}

export function buildSelectedTreatmentContext(item: ProcedureListItem, commercialPolicy?: string | null, experience?: ConversationExperience): string {
  const shouldDelayScheduling = experience === "concierge" && isAestheticTreatment(item.isAesthetic);
  const nextStep = shouldDelayScheduling
    ? "PRÓXIMO PASSO: responda a dúvida principal primeiro. Se o lead ainda estiver entendendo o tratamento, prefira encerrar com uma pergunta consultiva sobre a técnica ou a dúvida dele. Só conduza para avaliação depois de esclarecer o essencial. NÃO misture explicação técnica, convite de foto e pergunta de agenda na mesma resposta."
    : item.requiresEvaluationFirst
    ? "FECHAMENTO: use uma pergunta aberta que pressuponha que o lead vai agendar — ex: 'Qual seria o melhor momento para você fazer a avaliação?' ou 'Quando você teria disponibilidade?'. Nunca pergunte 'Quer verificar?' (fechado). Pressuposto de avanço, não pedido de permissão."
    : "FECHAMENTO: use uma pergunta aberta que pressuponha que o lead vai agendar — ex: 'Qual seria o melhor momento para você?' ou 'Que dia fica melhor para você?'. Nunca pergunte 'Quer agendar?' (fechado). Pressuposto de avanço, não pedido de permissão.";

  const details = [
    `Lead selecionou o procedimento "${item.name}" em uma lista numerada.`,
    item.description ? `Descrição cadastrada: ${item.description}` : null,
    item.requiresEvaluationFirst
      ? "Este procedimento exige avaliação antes do agendamento definitivo. Explique isso com naturalidade e conduza para avaliação."
      : "Explique o procedimento com naturalidade.",
    commercialPolicy ? `Política comercial: ${commercialPolicy}` : null,
    experience === "concierge" && isAestheticTreatment(item.isAesthetic) ? buildPhotoInviteInstruction() : null,
    nextStep,
    experience !== "concierge" ? "Mencione que o lead pode digitar *menu* a qualquer momento para ver outras opções." : null,
  ].filter(Boolean);

  const format = experience === "concierge"
    ? "FORMATO: tópicos — apresente os destaques do procedimento em até 4 bullet points (•), um por linha. Depois de listar, faça a pergunta de próximo passo."
    : "Formato: até 2 parágrafos curtos, sem lista.";

  return `${details.join("\n")}\n${format}`;
}

export function buildDirectTreatmentContext(treatment: Treatment, commercialPolicy?: string | null, experience?: ConversationExperience): string {
  const shouldDelayScheduling =
    experience === "concierge" &&
    isAestheticTreatment(treatment.isAesthetic);
  const nextStep = shouldDelayScheduling
    ? "PRÓXIMO PASSO: responda a dúvida principal primeiro. Se o lead ainda estiver conhecendo o tratamento, prefira encerrar com uma pergunta consultiva sobre técnicas, resultado ou expectativas. Só conduza para avaliação depois de esclarecer o essencial. NÃO misture explicação técnica, convite de foto e pergunta de agenda na mesma resposta."
    : treatment.requiresEvaluationFirst
    ? "FECHAMENTO: use uma pergunta aberta que pressuponha que o lead vai agendar — ex: 'Qual seria o melhor momento para você fazer a avaliação?' ou 'Quando você teria disponibilidade?'. Nunca pergunte 'Quer verificar?' (fechado). Pressuposto de avanço, não pedido de permissão."
    : "FECHAMENTO: use uma pergunta aberta que pressuponha que o lead vai agendar — ex: 'Qual seria o melhor momento para você?' ou 'Que dia fica melhor para você?'. Nunca pergunte 'Quer agendar?' (fechado). Pressuposto de avanço, não pedido de permissão.";

  const details = [
    `Lead mencionou diretamente o tratamento "${treatment.name}".`,
    treatment.description ? `Descrição cadastrada: ${treatment.description}` : null,
    treatment.requiresEvaluationFirst
      ? "Este procedimento exige avaliação antes do agendamento definitivo. Explique isso com naturalidade e conduza para avaliação."
      : "Explique o procedimento com naturalidade.",
    commercialPolicy ? `Política comercial: ${commercialPolicy}` : null,
    "Se a política comercial ou as orientações da clínica trouxerem valores, condições, técnicas ou limites explícitos para este tratamento, preserve esses dados na resposta.",
    "MÍDIA: se houver vídeo ou imagem na BIBLIOTECA DE MÍDIA com título relacionado a este tratamento, inclua [MEDIA:id] ao final da resposta conforme a regra da biblioteca.",
    experience === "concierge" && isAestheticTreatment(treatment.isAesthetic) ? buildPhotoInviteInstruction() : null,
    nextStep,
  ].filter(Boolean);

  // Não forçar bullet points aqui: o playbook de cada clínica define o formato
  // (prosa TTS-friendly ou bullets), e a instrução do actionContext sobreporia
  // as regras de voz das ORIENTAÇÕES DA CLÍNICA, causando bullets no áudio.
  const format = "Formato: até 2 parágrafos curtos. Siga as orientações de formato da clínica.";

  return `${details.join("\n")}\n${format}`;
}
// Isolamento entre procedimentos, aplicado na COMPOSIÇÃO do prompt: quando há
// um tratamento ativo nesta virada, a LLM só vê mídia geral (treatmentId null)
// ou dela — mídia de OUTRO procedimento nem aparece como opção no [MEDIA:id].
// Sem tratamento ativo, comportamento de hoje (lista completa da seleção do
// playbook). Reduz a chance de alucinação; a garantia dura é o gate abaixo,
// em resolveOutboundParts, que não depende da LLM ter obedecido este filtro.
export function filterMediaLibraryForTreatment<T extends { treatmentId?: string | null }>(
  items: T[],
  activeTreatmentId: string | null,
): T[] {
  if (!activeTreatmentId) return items;
  return items.filter((m) => !m.treatmentId || m.treatmentId === activeTreatmentId);
}

function isPriceMediaTitle(title: string): boolean {
  const n = normalizeFreeText(title);
  return hasAnyKeyword(n, ["valor", "valores", "preco", "investimento", "pacote", "pacotes"]);
}

export function filterMediaLibraryForComposer<T extends { title: string; treatmentId?: string | null }>(
  items: T[],
  activeTreatmentId: string | null,
  actionResult: ActionResult,
): T[] {
  const treatmentScoped = filterMediaLibraryForTreatment(items, activeTreatmentId);
  if (actionResult.type !== "price_inquiry") return treatmentScoped;

  const priceMedia = treatmentScoped.filter((item) => isPriceMediaTitle(item.title));
  return priceMedia.length > 0 ? priceMedia : treatmentScoped;
}

export function buildAlignedResponseMediaProjection<
  T extends { id: string; title: string; type: "video" | "image" },
>(filteredMediaLibrary: T[]): {
  composerMediaLibrary: T[];
  allowedMediaIds: string[];
} {
  return {
    composerMediaLibrary: filteredMediaLibrary,
    allowedMediaIds: filteredMediaLibrary.map((media) => media.id),
  };
}

export type DeliveryMediaLibraryItem = {
  id: string;
  title: string;
  type: "video" | "image";
  url: string;
  treatmentId?: string | null;
};

export function collectMediaIds(parts: ResponsePart[]): string[] {
  return Array.from(new Set(parts.filter((p): p is Extract<ResponsePart, { type: "media" }> => p.type === "media").map((p) => p.id)));
}

const MEDIA_ASSET_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * media_assets.id is a Postgres UUID. Keep malformed LLM tokens out of the
 * query boundary (for example the literal `[MEDIA:id]`).
 */
export function isValidMediaAssetId(id: string): boolean {
  return MEDIA_ASSET_UUID_RE.test(id);
}
export function formatBrl(cents: number): string {
  const reais = cents / 100;
  const isRound = cents % 100 === 0;
  return `R$ ${reais.toLocaleString("pt-BR", {
    minimumFractionDigits: isRound ? 0 : 2,
    maximumFractionDigits: isRound ? 0 : 2,
  })}`;
}
export function mergeDeliveryMediaLibrary(
  editorialMediaLibrary: DeliveryMediaLibraryItem[] | undefined,
  directlyReferencedAssets: DeliveryMediaLibraryItem[],
): DeliveryMediaLibraryItem[] {
  const merged = [...(editorialMediaLibrary ?? [])];
  const known = new Set(merged.map((m) => m.id));

  for (const asset of directlyReferencedAssets) {
    if (known.has(asset.id)) continue;
    merged.push(asset);
    known.add(asset.id);
  }

  return merged;
}
// Resolve as tags [MEDIA:id] das partes compostas contra a biblioteca de mídia,
// produzindo partes prontas para entrega. IDs ausentes são logados como erro crítico
// (vídeo perdido silenciosamente é pior do que log ruidoso) e pulados.
//
// activeTreatmentId é o GATE DETERMINÍSTICO de isolamento entre procedimentos
// (ver AGENTS.md "o sistema decide, a LLM verbaliza"): mesmo que a LLM emita
// um [MEDIA:id] de outro procedimento (alucinação ou prompt mal seguido), este
// gate bloqueia o envio — não depende do filtro de prompt acima ter funcionado.
export function resolveOutboundParts(
  parts: ResponsePart[],
  mediaLibrary: DeliveryMediaLibraryItem[] | undefined,
  log: Logger,
  activeTreatmentId: string | null = null,
): OutboundPart[] {
  const out: OutboundPart[] = [];
  const libraryIds = mediaLibrary?.map((m) => m.id) ?? [];

  for (const part of parts) {
    if (part.type === "text") {
      out.push({ type: "text", content: part.content });
      continue;
    }
    const item = mediaLibrary?.find((m) => m.id === part.id);
    if (!item) {
      // Erro crítico: o vídeo era esperado mas será silenciosamente omitido ao lead.
      // Causas comuns: (1) pipeline step com mediaId de versão antiga do playbook,
      // (2) vídeo re-uploadado com novo ID sem re-seeded o pipeline,
      // (3) LLM gerou ID inventado.
      log.error("mediaId não encontrado na biblioteca — vídeo será omitido ao lead", {
        mediaId: part.id,
        libraryIds,
        librarySize: libraryIds.length,
      });
      continue;
    }
    if (item.treatmentId && activeTreatmentId && item.treatmentId !== activeTreatmentId) {
      log.error("mediaId pertence a outro procedimento — vídeo será omitido ao lead (isolamento entre procedimentos)", {
        mediaId: item.id,
        itemTreatmentId: item.treatmentId,
        activeTreatmentId,
      });
      continue;
    }
    if (!item.url) {
      log.error("item da biblioteca sem URL — vídeo será omitido ao lead", {
        mediaId: item.id,
        title: item.title,
      });
      continue;
    }
    out.push({
      type: "media",
      mediaId: item.id,
      url: item.url,
      mediaType: item.type,
      title: item.title,
      caption: part.caption,
    });
  }
  return out;
}

// ─── Pipeline helpers ─────────────────────────────────────────────────────────

// Converte os blocos de um step "content" em ResponseParts prontas para envio.
export function buildPipelineContentParts(blocks: ContentBlock[]): ResponsePart[] {
  return blocks.map((b) =>
    b.kind === "text"
      ? { type: "text" as const, content: b.content }
      : { type: "media" as const, id: b.mediaId, caption: b.caption },
  );
}

function normalizeContentFingerprint(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function hasPipelineContentStepBeenSent(
  step: Extract<PipelineStep, { type: "content" }>,
  history: Pick<Message, "author" | "body">[],
  mediaTitleById?: Map<string, string>,
): boolean {
  if (step.once === false) return false;

  // Texto e legenda casam por SUBSTRING dentro do corpo já enviado.
  const substringFingerprints = step.blocks
    .map((block) => (block.kind === "text" ? block.content : block.caption ?? ""))
    .map(normalizeContentFingerprint)
    .filter(Boolean);

  // Mídia: o corpo gravado é o TÍTULO do arquivo (ver outbound-message-persistence),
  // nunca a legenda. Sem casar por título, um content step SÓ de mídia jamais era
  // reconhecido como enviado e reenviava a cada virada — o loop de vídeos da Ximendes
  // (23/07). Casamento EXATO de propósito: um título curto ("Vídeo") por substring
  // deduplicaria conteúdo alheio. Requer o mapa id→título (opcional p/ compatibilidade
  // dos callers que ainda não o passam).
  const exactMediaTitleFingerprints = step.blocks
    .flatMap((block) => {
      if (block.kind !== "media") return [];
      const title = mediaTitleById?.get(block.mediaId);
      return title ? [normalizeContentFingerprint(title)] : [];
    })
    .filter(Boolean);

  if (substringFingerprints.length === 0 && exactMediaTitleFingerprints.length === 0) return false;

  // clinic_user conta: conteúdo que a operação já enviou manualmente não deve
  // ser repetido pelo motor quando o pipeline assume a conversa depois.
  const outboundBodies = history
    .filter((message) => message.author === "agent" || message.author === "clinic_user")
    .map((message) => normalizeContentFingerprint(message.body));

  return (
    substringFingerprints.some((fp) => outboundBodies.some((body) => body.includes(fp))) ||
    exactMediaTitleFingerprints.some((fp) => outboundBodies.some((body) => body === fp))
  );
}

export function isPipelinePhotoInstructionContentStep(
  step: Extract<PipelineStep, { type: "content" }>,
): boolean {
  const text = [
    step.label,
    ...step.blocks.map((block) => block.kind === "text" ? block.content : block.caption ?? ""),
  ].join(" ");
  const normalized = normalizeFreeText(text);
  return hasAnyKeyword(normalized, ["foto", "fotos", "video", "videos", "frontal", "perfil", "pre avaliacao"]);
}

// Contexto do answer-first quando o conteúdo do pipeline sai na MESMA resposta:
// o composer precisa VER o que o conteúdo já cobre para não respondê-lo de novo.
// A instrução genérica ("não descreva o tratamento") não bastava — sem enxergar
// o texto que vem a seguir, o LLM explicava tudo e os cards repetiam logo abaixo
// (replay Vitalli 18/07).
export function buildDeferredPipelineAnswerContext(params: {
  treatmentName: string;
  contentBlocks: ContentBlock[];
  treatmentDescription?: string | null;
  commercialPolicy?: string | null;
}): string {
  const contentPreview = params.contentBlocks
    .map((block) => (block.kind === "text" ? block.content : `[mídia anexada${block.caption ? `: ${block.caption}` : ""}]`))
    .join("\n");
  return [
    `Lead está em conversa consultiva sobre "${params.treatmentName}".`,
    "LOGO APÓS a sua resposta, o sistema envia automaticamente este conteúdo pronto na mesma mensagem:",
    "─── CONTEÚDO QUE SERÁ ENVIADO ───",
    contentPreview,
    "─── FIM DO CONTEÚDO ───",
    "Sua resposta deve ter NO MÁXIMO 2 frases curtas: responda só o que o conteúdo acima NÃO cobre (cortesia, pergunta pessoal do lead) e faça uma ponte curta para ele.",
    "NÃO repita nem resuma o conteúdo acima. NÃO explique técnicas, diferenças ou valores que ele já apresenta. NÃO convide para avaliação/agendamento, NÃO peça foto e NÃO termine com pergunta — o conteúdo seguinte conduz.",
    params.treatmentDescription ? `Descrição do tratamento (apenas contexto, não recite): ${params.treatmentDescription}` : null,
    params.commercialPolicy ? `Política comercial (apenas contexto, não recite): ${params.commercialPolicy}` : null,
  ].filter(Boolean).join("\n");
}

// Contrato do answer-first: a resposta do composer é só a ponte curta — o
// conteúdo canônico vem dos blocos do pipeline logo em seguida. A instrução de
// prompt pede no máximo 2 frases, mas o LLM nem sempre obedece; quando ele se
// alonga, o sistema corta no primeiro parágrafo (o playbook decide o conteúdo,
// não a improvisação do modelo).
export function trimAnswerToBridge(answerText: string): string {
  const paragraphs = answerText.trim().split(/\n{2,}/);
  return (paragraphs[0] ?? "").trim();
}

export function buildAnswerFirstPipelineContent(params: {
  answerText: string;
  answerParts: ResponsePart[];
  contentBlocks: ContentBlock[];
}): { replyText: string; parts: ResponsePart[]; mediaIds: string[] } {
  const contentParts = buildPipelineContentParts(params.contentBlocks);
  const contentText = contentParts
    .filter((part): part is Extract<ResponsePart, { type: "text" }> => part.type === "text")
    .map((part) => part.content)
    .join("\n\n")
    .trim();
  const bridgeText = trimAnswerToBridge(params.answerText);
  // A ponte vira um único bloco de texto; partes não-textuais da resposta
  // (ex.: mídia anexada pelo composer) são preservadas antes do conteúdo.
  const nonTextAnswerParts = params.answerParts.filter((part) => part.type !== "text");
  const bridgeParts: ResponsePart[] = bridgeText ? [{ type: "text", content: bridgeText }] : [];
  const replyText = [bridgeText, contentText].filter(Boolean).join("\n\n");
  const parts = [...bridgeParts, ...nonTextAnswerParts, ...contentParts];

  return {
    replyText,
    parts,
    mediaIds: collectMediaIds(parts),
  };
}

// N1 (mapeamento 18/07, caso Nathan): quando a mensagem do lead é interesse
// genérico no tratamento do pipeline ("quero entender como funciona e valores"),
// o conteúdo curado É a resposta — compor explicação por LLM antes duplica a
// informação e vaza valores em prosa. Detector conservador: qualquer token fora
// do vocabulário de interesse (além de saudação e menção ao tratamento) mantém
// o answer-first, que segue sendo o caminho certo para perguntas específicas.
const GENERIC_INTEREST_VOCABULARY = new Set([
  "ola", "oi", "eae", "hey", "bom", "boa", "dia", "tarde", "noite", "tudo", "bem",
  "quero", "queria", "gostaria", "quer", "adoraria", "sim", "pode", "claro", "por", "favor", "pfv",
  "saber", "entender", "enteder", "conhecer", "ver", "escutar", "ouvir",
  "mais", "um", "uma", "uns", "umas", "pouco", "pouquinho", "melhor",
  "sobre", "como", "funciona", "seria", "e", "de", "do", "da", "dos", "das", "o", "a", "os", "as", "no", "na",
  "posso", "consigo", "transformar", "mudar", "melhorar", "arrumar", "meu", "minha", "sorriso", "dente", "dentes",
  "com", "para", "pra", "tambem", "tbm", "ne",
  "valor", "valores", "preco", "precos", "custo", "custos", "investimento",
  "informacao", "informacoes", "detalhe", "detalhes", "duvida", "duvidas",
  "me", "conta", "conte", "explica", "explicar", "fala", "falar", "mostra", "mostrar",
  "tenho", "interesse", "interessado", "interessada", "interessei",
  "esse", "essa", "isso", "este", "esta", "isto", "aqui",
  "voces", "vcs", "procedimento", "tratamento", "gente",
  // W3.4 (caso Felipe 19/07): "Ambas" respondendo "quer entender como funciona
  // ou ver valores?" é interesse genérico nas duas técnicas — direto ao conteúdo.
  "ambas", "ambos", "duas", "dois", "tecnica", "tecnicas", "opcoes", "opcao",
]);

export function isGenericTreatmentInterestMessage(message: string, treatment: Treatment): boolean {
  const normalized = normalizeFreeText(message);
  if (!normalized) return false;
  const treatmentTokens = new Set(
    [treatment.name, ...(treatment.aliases ?? [])]
      .flatMap((name) => normalizeFreeText(name).split(/\s+/))
      .filter(Boolean),
  );
  return normalized
    .split(/\s+/)
    .every((token) => GENERIC_INTEREST_VOCABULARY.has(token) || treatmentTokens.has(token));
}

// J7 (mapeamento 18/07, caso João Vitor): convite de avaliação/agenda/foto em
// turnos consecutivos sem reação do lead derruba conversão — "faz o cliente
// fugir" (validação real). O sistema decide se o turno pode fechar com CTA; a
// LLM só verbaliza.
const AGENT_CTA_PHRASES = [
  "que tal agendar",
  "que tal agendarmos",
  "vamos agendar",
  "podemos agendar",
  "posso agendar",
  "quer agendar",
  "gostaria de agendar",
  "que tal marcar",
  "posso ver os horarios",
  "posso mostrar os horarios",
  "posso te mostrar os horarios",
  "ver os horarios disponiveis",
  "agendar uma avaliacao",
  "agendarmos uma avaliacao",
  "marcar uma avaliacao",
  "marcarmos uma avaliacao",
  "que tal uma avaliacao",
  "agendar sua avaliacao",
  "enviar uma foto",
  "envie uma foto",
  "enviar a foto",
  "me encaminhar uma foto",
  "encaminhar uma foto",
  "manda uma foto",
  "mandar uma foto",
  "foto do seu sorriso",
];

function agentMessageEndsWithCta(body: string): boolean {
  const normalized = normalizeFreeText(body);
  if (!normalized) return false;
  return AGENT_CTA_PHRASES.some((phrase) => normalized.includes(phrase));
}

function leadEngagesWithCta(message: string): boolean {
  const normalized = normalizeFreeText(message);
  if (!normalized) return false;
  const words = new Set(normalized.split(/\s+/));
  const wordSignals = [
    "agendar", "agendarmos", "marcar", "marcarmos", "horario", "horarios", "agenda",
    "sim", "pode", "podemos", "claro", "bora", "vamos", "quando", "foto", "fotos",
  ];
  if (wordSignals.some((word) => words.has(word))) return true;
  const phraseSignals = ["pode ser", "quero sim", "como faco", "como agendo", "to dentro", "tou dentro"];
  return phraseSignals.some((phrase) => normalized.includes(phrase));
}

// Turno anterior do agente: percorre o histórico do fim para o início, pula o
// burst atual do lead e coleta as mensagens de agente/operador até encontrar a
// mensagem anterior do lead. Operador conta: CTA humano ignorado também não
// deve ser repetido pela IA.
export function collectPreviousAgentTurnBodies(
  history: Pick<Message, "author" | "body">[],
): string[] {
  const bodies: string[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i];
    if (message.author === "lead") {
      if (bodies.length > 0) break;
      continue;
    }
    if (message.author === "agent" || message.author === "clinic_user") {
      bodies.push(message.body);
    }
  }
  return bodies;
}

export function shouldSuppressNextStepCta(params: {
  previousAgentMessages: string[];
  currentLeadMessage: string;
}): boolean {
  const previousHadCta = params.previousAgentMessages.some(agentMessageEndsWithCta);
  if (!previousHadCta) return false;
  return !leadEngagesWithCta(params.currentLeadMessage);
}

// J8 (teste real 18/07 22:18): no passo de Q&A, o pedido de foto NÃO se acopla
// a respostas de descoberta ("me mostra as cores") — pergunta é sinal de
// exploração, não de prontidão. Conteúdo comum segue anexável nos momentos de
// ritmo (mídia por keyword ou afirmativa curta); a instrução de foto só entra
// quando o lead sinaliza prontidão com afirmativa curta. Sem prontidão, o Q&A
// permanece aberto e o passo de foto pede na vez dele (fim dos qaTurns).
export function canAppendQaFollowUpContent(params: {
  nextContentIsPhotoInstruction: boolean;
  keywordMediaMatched: boolean;
  leadMessage: string;
}): boolean {
  if (params.nextContentIsPhotoInstruction) {
    return isShortAffirmativeReply(params.leadMessage) ||
      isRemotePreEvaluationRequest(params.leadMessage);
  }
  return params.keywordMediaMatched || isShortAffirmativeReply(params.leadMessage);
}

// J2 (mapeamento 18/07, caso João Vitor): afirmativa curta respondendo a uma
// oferta aberta do agente é ACEITE da oferta — não saudação nem ack. Sem este
// guard, o gap de horas marcava a conversa como stale e o "Boa noite pode sim"
// recebia o starter da Gleice de novo, engolindo o aceite do lead.
const OPEN_OFFER_PHRASES = [
  "posso te ajudar",
  "posso ajudar",
  "posso te mostrar",
  "posso te passar",
  "posso te explicar",
  "posso te enviar",
  "quer que eu",
  "quer entender",
  "quer saber",
  "quer ver",
  "me conta",
  "gostaria de saber",
  "gostaria de ver",
  "gostaria de entender",
];

const LEAD_GREETING_PREFIX_RE = /^(?:ola|oi|opa|eae|bom dia|boa tarde|boa noite)\b\s*/;

export function isAffirmativeReplyToOpenOffer(params: {
  lastAgentMessage: string | null | undefined;
  message: string;
}): boolean {
  if (!params.lastAgentMessage) return false;
  const strippedLeadMessage = normalizeFreeText(params.message).replace(LEAD_GREETING_PREFIX_RE, "").trim();
  if (!isShortAffirmativeReply(strippedLeadMessage)) return false;
  if (params.lastAgentMessage.trim().endsWith("?")) return true;
  const normalizedOffer = normalizeFreeText(params.lastAgentMessage);
  return OPEN_OFFER_PHRASES.some((phrase) => normalizedOffer.includes(phrase));
}

// J4 (caso João Vitor): num burst, "20 lentes" seguido de outra pergunta era
// respondido só pela última mensagem — o valor exato do pacote sumia. Recolhe
// o burst atual do lead (mensagens após a última resposta do agente/operador),
// em ordem cronológica, incluindo a mensagem atual.
export function collectCurrentLeadBurstBodies(
  history: Pick<Message, "author" | "body">[],
): string[] {
  const bodies: string[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i];
    if (message.author === "lead") {
      bodies.unshift(message.body);
      continue;
    }
    if (message.author === "agent" || message.author === "clinic_user") break;
  }
  return bodies;
}

// J4: quando o sistema já abriu a resposta com os valores exatos do pacote, a
// prosa da LLM não pode repetir números — instrução sozinha não segura o modelo
// (validado em replay 19/07). Remove parágrafos com R$ e os anúncios que os
// introduziam ("Para 20 lentes, os valores são:") para não sobrar frase órfã.
export function stripPriceProseWhenSystemQuoted(text: string): string {
  const kept: string[] = [];
  for (const paragraph of text.split("\n\n")) {
    if (/r\$\s?\d/i.test(paragraph)) {
      if (kept.length > 0 && /:\s*$/.test(kept[kept.length - 1].trim())) kept.pop();
      continue;
    }
    kept.push(paragraph);
  }
  while (
    kept.length > 0 &&
    /(valor|valores|investimento|pre[çc]o|pre[çc]os|pacote)[^\n]*:\s*$/i.test(kept[kept.length - 1].trim())
  ) {
    kept.pop();
  }
  return kept.join("\n\n").trim();
}

// T2 (caso Barbara): criativo de anúncio encaminhado APÓS a saudação virava
// "foto clínica" e pulava o funil. A proteção certa não é "o agente já falou",
// e sim "o agente já pediu foto" — antes do pedido, mídia colada num opener de
// anúncio ainda é criativo.
const AGENT_PHOTO_REQUEST_RE =
  /foto\s+(?:do|de)\s+(?:seu\s+)?sorriso|encaminhar\s+uma\s+foto|enviar\s+uma\s+foto|envie\s+uma\s+foto|nos\s+encaminhar\s+uma\s+foto|mandar?\s+uma\s+foto|foto\s+ou\s+(?:um\s+)?video|foto\s+clara\s+ou\s+um\s+video/;

export function hasAgentRequestedPhoto(
  history: Pick<Message, "author" | "body">[],
): boolean {
  return history.some(
    (message) =>
      (message.author === "agent" || message.author === "clinic_user") &&
      AGENT_PHOTO_REQUEST_RE.test(normalizeFreeText(message.body)),
  );
}

// J6 (caso João Vitor): "queria ver um pouco do trabalho de vocês" prometia
// casos e não entregava nada — a seleção de vitrine é do sistema, não da LLM.
const SHOWCASE_REQUEST_PHRASES = [
  "ver o trabalho",
  "ver os trabalhos",
  "ver trabalhos",
  "trabalho de voces",
  "trabalhos de voces",
  "ver casos",
  "casos de sucesso",
  "ver resultados",
  "ver resultado",
  "ver algum resultado",
  "antes e depois",
  "fotos de resultado",
  "fotos de resultados",
  "fotos de casos",
  "exemplos de resultado",
  "ver exemplos",
  "trabalhos anteriores",
  "trabalhos realizados",
  "trabalhos ja feitos",
  "portfolio",
];

export function isShowcaseRequestText(message: string): boolean {
  const normalized = normalizeFreeText(message);
  if (!normalized) return false;
  return SHOWCASE_REQUEST_PHRASES.some((phrase) => normalized.includes(phrase));
}

const SHOWCASE_MEDIA_TITLE_RE = /resultado|caso|antes e depois/i;

export function pickShowcaseMedia<T extends { id: string; title: string; treatmentId?: string | null }>(
  library: T[],
  treatmentId: string | null,
  limit = 2,
): T[] {
  const candidates = library.filter((item) => SHOWCASE_MEDIA_TITLE_RE.test(item.title));
  const scoped = treatmentId
    ? candidates.filter((item) => !item.treatmentId || item.treatmentId === treatmentId)
    : candidates;
  return scoped.slice(0, limit);
}
// Retorna o próximo step do pipeline que requer condução ativa (content, qa, photo).
// Steps ask_availability / offer_slots / book são documentação para o doutor;
// o fluxo reativo existente os cobre quando o lead expressa intenção.
// Exportado: a ação guiada do Inbox usa para posicionar o pipeline no passo certo.
export function nextActivePipelineStep(
  steps: PipelineStep[],
  fromIndex: number,
  options?: {
    skipOptionalPhoto?: boolean;
    skipPhotoInstructionContent?: boolean;
    conversationHistory?: Pick<Message, "author" | "body">[];
    mediaTitleById?: Map<string, string>;
  },
): { step: PipelineStep; index: number } | null {
  for (let i = fromIndex; i < steps.length; i++) {
    const s = steps[i];
    if (s.type === "photo" && options?.skipOptionalPhoto && !s.required) {
      continue;
    }
    if (s.type === "content" && options?.skipPhotoInstructionContent && isPipelinePhotoInstructionContentStep(s)) {
      continue;
    }
    if (
      s.type === "content" &&
      options?.conversationHistory &&
      hasPipelineContentStepBeenSent(s, options.conversationHistory, options.mediaTitleById)
    ) {
      continue;
    }
    if (s.type === "content" || s.type === "qa" || s.type === "photo") {
      return { step: s, index: i };
    }
  }
  return null;
}

export function nextUnsentPipelineContentStep(
  steps: PipelineStep[],
  fromIndex: number,
  conversationHistory: Pick<Message, "author" | "body">[],
  mediaTitleById?: Map<string, string>,
): { step: Extract<PipelineStep, { type: "content" }>; index: number } | null {
  for (let i = fromIndex; i < steps.length; i++) {
    const step = steps[i];
    if (step.type === "ask_availability" || step.type === "offer_slots" || step.type === "book") {
      return null;
    }
    if (step.type === "content" && !hasPipelineContentStepBeenSent(step, conversationHistory, mediaTitleById)) {
      return { step, index: i };
    }
  }
  return null;
}

export function buildPipelineContentReply(step: Extract<PipelineStep, { type: "content" }>): {
  replyText: string;
  parts: ResponsePart[];
  mediaIds: string[];
} {
  const parts = buildPipelineContentParts(step.blocks);
  return {
    replyText: parts
      .filter((p): p is { type: "text"; content: string } => p.type === "text")
      .map((p) => p.content)
      .join("\n\n"),
    parts,
    mediaIds: collectMediaIds(parts),
  };
}

export function isEvaluationPriceRequest(message: string): boolean {
  const normalized = normalizeFreeText(message);
  if (!normalized.includes("avaliacao")) return false;
  // W3.1 (caso Lineeh 19/07): o preço perguntado precisa ser DA AVALIAÇÃO.
  // "Quero valores, formas de pagamento e fazer uma avaliação" é pedido de
  // preço do TRATAMENTO + intenção de agendar — responder só o sinal de R$ 30
  // engolia os valores e gerava fricção ("não dá para avaliar por aqui?").
  return (
    /\b(?:valor|valores|preco|precos|custo)\s+(?:d[ae]s?\s+|para\s+|pra\s+)?(?:uma\s+|a\s+)?avaliacao\b/.test(normalized) ||
    /\bquanto\s+(?:custa|cobra|cobram|fica|sai|e)\s+(?:uma\s+|a\s+)?avaliacao\b/.test(normalized) ||
    /\bavaliacao\s+(?:e\s+)?(?:cobrada?|paga|gratuita|gratis|de\s+graca|custa|tem\s+custo)\b/.test(normalized)
  );
}

export function isClinicalTreatmentPlanJudgmentRequest(message: string): boolean {
  const normalized = normalizeFreeText(message);
  if (!normalized) return false;
  const asksCaseSpecificScope = hasAnyKeyword(normalized, [
    "fechar os espacos",
    "fechar os espacinhos",
    "fechar espacos",
    "fechar espacinhos",
    "pouca resina",
    "menos resina",
    "so resina",
    "quanto de resina",
    "quantidade de resina",
  ]);
  const combinesProcedures =
    (normalized.includes("resina") || normalized.includes("lente")) &&
    normalized.includes("clareamento") &&
    (message.includes("+") || hasAnyKeyword(normalized, ["junto", "combinar", "combinado", "e clareamento"]));
  return asksCaseSpecificScope || combinesProcedures;
}

export function buildEvaluationDepositClarification(
  depositAmountCents: number,
  evaluation?: { priceCents: number | null; priceQuotableInChat: boolean } | null,
): string {
  const amount = formatBrl(depositAmountCents);
  const evaluationLine = evaluation?.priceQuotableInChat
    ? evaluation.priceCents === 0
      ? "A avaliação não tem custo."
      : evaluation.priceCents != null
        ? `A avaliação custa ${formatBrl(evaluation.priceCents)}.`
        : "O valor da avaliação precisa ser confirmado pela equipe."
    : "O valor da avaliação precisa ser confirmado pela equipe.";
  return [
    evaluationLine,
    "",
    `Para reservar o horário da avaliação, a clínica pede um sinal de ${amount}.`,
    "",
    "O sinal é separado do valor da avaliação: ele garante a reserva e é abatido do tratamento se você avançar.",
    "",
    "Posso te mostrar os horários disponíveis agora?",
  ].join("\n");
}

export function contextualizeReplyWhileAwaitingDeposit(
  replyText: string,
  slotLabel: string,
): string {
  const paragraphs = replyText.trim().split(/\n\s*\n/);
  while (
    paragraphs.length > 0 &&
    /(?:posso|quer|vamos|que tal).*(?:ver|mostrar|buscar|agendar).*(?:horarios?|agenda|avaliacao)/i.test(
      normalizeFreeText(paragraphs[paragraphs.length - 1]),
    )
  ) {
    paragraphs.pop();
  }
  return [
    paragraphs.join("\n\n").trim(),
    `Seu horário de ${slotLabel} continua reservado provisoriamente. Para confirmá-lo, envie o comprovante do sinal nesta conversa.`,
  ].filter(Boolean).join("\n\n");
}
