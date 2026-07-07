import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/infrastructure/db/client";
import { playbookVersions, treatments } from "@/infrastructure/db/schema";
import { DrizzleMediaAssetRepository } from "@/infrastructure/repositories/drizzle-media-asset-repository";
import { createLogger } from "@/infrastructure/logging/logger";
export { lintPlaybookNotes, blockingPlaybookNotesIssues, lintCommercialPolicy, blockingTreatmentDescriptionIssues } from "./playbook-lint";

const mediaAssetRepo = new DrizzleMediaAssetRepository();

/**
 * FONTE ÚNICA DA VERDADE EDITORIAL.
 *
 * Antes deste módulo existiam três fontes que "pareciam" a configuração da IA:
 *  - playbook_versions (versão publicada)
 *  - organizations.commercialPolicy / organizations.playbook (o que a produção lia)
 *  - treatments (procedimentos)
 *
 * A produção lia um Frankenstein de pedaços de cada uma. Resultado: o cliente
 * publicava no playbook e a produção continuava lendo o organizations antigo.
 *
 * Regra agora:
 *  - O DONO do conteúdo editorial é a versão `active` de playbook_versions.
 *  - O DONO dos procedimentos é a tabela `treatments` (estruturado, agendável).
 *  - O texto do playbook entregue à IA é COMPOSTO a partir desses campos
 *    estruturados — nunca digitado como blob livre.
 *  - organizations deixa de ser fonte de qualquer campo editorial.
 */

export type EditorialProcedure = {
  name: string;
  description: string | null;
};

/**
 * Fato de preço estruturado de um tratamento (Camada 1). A prosa que a IA fala
 * é DERIVADA daqui por `composePriceSection` — nunca redigitada na commercialPolicy.
 */
export type TreatmentPriceFact = {
  name: string;
  priceCents: number | null;
  minPriceCents: number | null;
  priceQuotableInChat: boolean;
  priceKind: "from" | "fixed";
  priceUnit: string | null;
  priceDeductible: boolean;
};

function formatBrl(cents: number): string {
  const reais = cents / 100;
  const isRound = cents % 100 === 0;
  return `R$ ${reais.toLocaleString("pt-BR", {
    minimumFractionDigits: isRound ? 0 : 2,
    maximumFractionDigits: isRound ? 0 : 2,
  })}`;
}

/**
 * DERIVA a seção de preço da política comercial a partir dos fatos estruturados
 * do treatment (Item 3 — "um fato, um dono"). Substitui o preço digitado à mão
 * na `commercialPolicy`, para que o número que a IA fala NUNCA possa divergir do
 * número do Financeiro (`treatments.priceCents`), porque nasce dele.
 *
 * Prosa TTS-safe (sem bullets/traços — o LLM reproduz a tipografia que lê).
 * Retorna string vazia quando nenhum tratamento é cotável por mensagem — nesse
 * caso a `commercialPolicy` humana (só enquadramento) segue intacta.
 */
export function composePriceSection(treatments: TreatmentPriceFact[]): string {
  const quotable = treatments.filter((t) => {
    const value = t.priceKind === "fixed" ? (t.priceCents ?? t.minPriceCents) : (t.minPriceCents ?? t.priceCents);
    return t.priceQuotableInChat && value != null;
  });
  if (quotable.length === 0) return "";

  const lines = quotable.map((t) => {
    const value = t.priceKind === "fixed" ? (t.priceCents ?? t.minPriceCents)! : (t.minPriceCents ?? t.priceCents)!;
    const unit = t.priceUnit?.trim() ? ` (${t.priceUnit.trim()})` : "";
    const base =
      t.priceKind === "from"
        ? `${t.name}: a partir de ${formatBrl(value)}${unit}; o valor exato é definido na avaliação.`
        : `${t.name}: ${formatBrl(value)}${unit}.`;
    const deductible = t.priceDeductible
      ? " Esse valor é abatido integralmente do tratamento se o paciente decidir avançar; sempre mencione esse abatimento."
      : "";
    return base + deductible;
  });

  const hasNonQuotable = treatments.length > quotable.length;
  if (hasNonQuotable) {
    lines.push(
      "Para os demais procedimentos, não informe valores por mensagem — oriente que os valores são definidos na avaliação com o profissional.",
    );
  }

  return `VALORES (informe exatamente estes; nunca invente outros):\n${lines.join("\n")}`;
}

export type MediaLibraryItem = {
  id: string;
  title: string;
  url: string;
  type: "video" | "image";
  /**
   * Procedimento dono desta mídia (null = geral). Gate de isolamento entre
   * procedimentos: ConversationOrchestrator filtra o prompt e bloqueia o envio
   * quando este id diverge do tratamento ativo da conversa — nunca confiar só
   * na instrução textual do prompt para esse isolamento.
   */
  treatmentId: string | null;
};

/**
 * FONTE ÚNICA de leitura da biblioteca de mídia de uma versão de playbook.
 * Lê `media_asset_ids` (ponteiros para a tabela clinic-level `media_assets`,
 * que é a dona real do arquivo). Se vier vazio mas o jsonb legado
 * `media_library` tiver itens — versão anterior à migração que promoveu a
 * biblioteca para tabela própria — cai no legado e loga warn (sinal de que o
 * backfill não cobriu essa versão; nunca deve acontecer em produção pós-deploy,
 * mas evita omitir mídia ao lead silenciosamente enquanto investiga).
 */
export async function resolveMediaLibraryForVersion(
  clinicId: string,
  version: {
    id: string;
    mediaAssetIds?: string[] | null;
    mediaLibrary?: unknown;
  },
): Promise<MediaLibraryItem[]> {
  const assetIds = version.mediaAssetIds ?? [];
  if (assetIds.length > 0) {
    const assets = await mediaAssetRepo.findByIds(clinicId, assetIds);
    return assets.map((a) => ({
      id: a.id,
      title: a.title,
      url: a.url,
      // Fase 3 (documentos) amplia este tipo fim-a-fim; até lá a seleção do
      // playbook só oferece video/image no upload, então o cast é seguro.
      type: a.type as "video" | "image",
      treatmentId: a.treatmentId,
    }));
  }

  const legacy = (version.mediaLibrary as
    | { id: string; title: string; url: string; type: "video" | "image" }[]
    | null
    | undefined) ?? [];
  if (legacy.length > 0) {
    createLogger({ scope: "EditorialConfig", clinicId }).warn(
      "playbook version com media_library legado não migrado para media_asset_ids",
      { playbookVersionId: version.id, legacyCount: legacy.length },
    );
    return legacy.map((m) => ({ ...m, treatmentId: null }));
  }

  return [];
}

export type EditorialConfig = {
  specialty: string | null;
  toneOfVoice: string | null;
  commercialPolicy: string | null;
  procedures: EditorialProcedure[];
  receptionistName: string;
  differentials: string[];
  objections: { objection: string; response: string }[];
  mediaLibrary: MediaLibraryItem[];
  /** Texto pronto para o prompt, composto a partir dos campos estruturados. */
  playbookText: string;
};

/**
 * Gate de validação de publicação. Uma versão só pode virar `active` se passar
 * aqui. É isto que impede a IA de receber dado vazio (ex: política comercial
 * em branco) e, por consequência, de alucinar para preencher a lacuna.
 */
export const publishablePlaybookSchema = z.object({
  specialty: z.string().trim().min(1, "especialidade é obrigatória"),
  commercialPolicy: z
    .string()
    .trim()
    .min(1, "política comercial não pode ser vazia (a IA inventaria condições)"),
  // Item 4: `procedureDescription` foi aposentado — a descrição de procedimento é
  // dona da tabela `treatments` (uma por procedimento), não mais um blob no playbook.
  toneOfVoice: z.string().trim().min(1).default("acolhedor"),
  receptionistName: z.string().trim().min(1, "nome da recepcionista é obrigatório").default("Marina"),
  differentials: z.array(z.string()).default([]),
  objections: z
    .array(z.object({ objection: z.string(), response: z.string() }))
    .default([]),
  greetingMessage: z.string().optional(),
});

export type PublishablePlaybook = z.infer<typeof publishablePlaybookSchema>;

/**
 * Compõe o texto de orientação da IA a partir dos campos estruturados.
 * Determinístico: a mesma versão ativa sempre gera o mesmo texto, então
 * simulador e produção leem exatamente a mesma coisa.
 */
export function composePlaybookText(parts: {
  differentials?: string[] | null;
  objections?: { objection: string; response: string }[] | null;
  procedures?: EditorialProcedure[];
  notes?: string | null;
  mediaLibrary?: MediaLibraryItem[] | null;
}): string {
  const sections: string[] = [];

  if (parts.notes?.trim()) {
    sections.push(parts.notes.trim());
  }

  // Item 4 (config ownership): a lista estruturada de `treatments` é o ÚNICO dono
  // da descrição de procedimento. O fallback para `playbook_versions.procedureDescription`
  // foi aposentado — dois donos para "o que é o procedimento" causavam drift.
  const procedureList = (parts.procedures ?? [])
    .map((p) => (p.description ? `• ${p.name} — ${p.description}` : `• ${p.name}`))
    .join("\n");

  if (procedureList) {
    sections.push(`PROCEDIMENTOS OFERECIDOS:\n${procedureList}`);
  }

  const differentials = (parts.differentials ?? []).filter(Boolean);
  if (differentials.length > 0) {
    sections.push(`DIFERENCIAIS:\n${differentials.map((d) => `• ${d}`).join("\n")}`);
  }

  const objections = (parts.objections ?? []).filter((o) => o.objection && o.response);
  if (objections.length > 0) {
    const text = objections.map((o) => `- "${o.objection}" → ${o.response}`).join("\n");
    sections.push(`COMO LIDAR COM OBJEÇÕES:\n${text}`);
  }

  // Nota: mediaLibrary não é listada aqui com URL. Os vídeos/imagens são injetados
  // no system prompt via clinic.mediaLibrary → buildSystemPrompt com a instrução
  // [MEDIA:id] correta. Listar URLs aqui criaria um segundo bloco conflitante.

  return sections.join("\n\n");
}

/**
 * Lê a configuração editorial ativa de uma clínica. Esta é a ÚNICA função que
 * o runtime (orchestrator, crons, simulador) deve usar para obter dado
 * editorial. Retorna null se não houver versão ativa publicada.
 */
export async function resolveActiveEditorialConfig(
  clinicId: string,
): Promise<EditorialConfig | null> {
  const [activeVersion, clinicTreatments] = await Promise.all([
    db
      .select()
      .from(playbookVersions)
      .where(
        and(
          eq(playbookVersions.clinicId, clinicId),
          eq(playbookVersions.status, "active"),
        ),
      )
      .orderBy(desc(playbookVersions.createdAt))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({
        name: treatments.name,
        description: treatments.description,
        priceCents: treatments.priceCents,
        minPriceCents: treatments.minPriceCents,
        priceQuotableInChat: treatments.priceQuotableInChat,
        priceKind: treatments.priceKind,
        priceUnit: treatments.priceUnit,
        priceDeductible: treatments.priceDeductible,
      })
      .from(treatments)
      .where(eq(treatments.clinicId, clinicId)),
  ]);

  if (!activeVersion) return null;

  const procedures: EditorialProcedure[] = clinicTreatments.map((t) => ({
    name: t.name,
    description: t.description,
  }));

  // Item 3: a seção de preço é DERIVADA dos fatos estruturados do treatment e
  // prefixada à política comercial que o runtime lê. A `commercialPolicy` humana
  // (campo do playbook) permanece só com enquadramento não-numérico. Aditivo:
  // sem preço estruturado, a política humana segue intacta (zero regressão).
  const derivedPriceSection = composePriceSection(clinicTreatments);
  const humanPolicy = activeVersion.commercialPolicy?.trim() || null;
  const commercialPolicy =
    [derivedPriceSection || null, humanPolicy].filter(Boolean).join("\n\n") || null;

  const differentials = (activeVersion.differentials as string[] | null) ?? [];
  const objections =
    (activeVersion.objections as { objection: string; response: string }[] | null) ?? [];
  const mediaLibrary = await resolveMediaLibraryForVersion(clinicId, activeVersion);

  return {
    specialty: activeVersion.specialty,
    toneOfVoice: activeVersion.toneOfVoice,
    commercialPolicy,
    receptionistName: activeVersion.receptionistName,
    procedures,
    differentials,
    objections,
    mediaLibrary,
    playbookText: composePlaybookText({
      differentials,
      objections,
      procedures,
      notes: activeVersion.notes,
      mediaLibrary,
    }),
  };
}
