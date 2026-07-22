/**
 * Motor de Reativação (ADR-009), Fase 2 — resolução de audiência.
 *
 * **Uma única função decide quem recebe.** O preview que a clínica aprova e os
 * alvos que são materializados saem daqui, da mesma query, com o mesmo segmento.
 * Ter dois caminhos seria o furo mais caro possível: a clínica aprova 40 e o
 * sistema manda para 300.
 *
 * As exclusões de segurança abaixo são incondicionais — não dependem do que a
 * clínica configurou. O segmento só ajusta *limites* (quantos dias, quantas
 * campanhas), nunca desliga uma proteção.
 *
 * Isto NÃO substitui o Safety Gate. O gate roda no envio e reavalia opt-out,
 * caps e quiet hours no momento certo. Aqui é a seleção comercial; lá é a
 * última linha de defesa do canal.
 */

import { sql } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import type { AudienceSegment } from "@/application/reactivation/audience-segment";
import { validateSegment } from "@/application/reactivation/audience-segment";

export type AudienceLead = {
  lead_id: string;
  conversation_id: string;
  name: string | null;
  phone: string | null;
  whatsapp_lid: string | null;
  treatment_interest: string | null;
  lead_status: string;
  outcome_reason: string | null;
  outcome_confidence: number | null;
  silence_stage: string | null;
  evidence_excerpt: string | null;
  last_message_at: string;
};

export type AudiencePreview = {
  /** Quantos o segmento encontrou. */
  total: number;
  /**
   * Quantos de fato virariam alvos — `min(total, MAX_AUDIENCE_SIZE)`.
   *
   * Existe porque `total` sozinho mente quando o segmento estoura o teto: a
   * clínica veria 655, aprovaria, e receberia 500. A UI precisa mostrar os dois
   * números e avisar do corte; por isso `truncated` é explícito e não inferido.
   */
  willMaterialize: number;
  truncated: boolean;
  sample: AudienceLead[];
  /** Por motivo de não-fechamento — dá à clínica a leitura antes de aprovar. */
  byReason: Array<{ reason: string | null; count: number }>;
  /** Por estágio do silêncio — a quebra que orienta a decisão de campanha. */
  byStage: Array<{ stage: string | null; count: number }>;
};

/** Amostra mostrada no preview. O total vem da contagem completa, não daqui. */
const PREVIEW_SAMPLE_SIZE = 15;

/**
 * Teto duro por campanha. Mesmo que o segmento pegue 2000 pessoas, uma campanha
 * não materializa mais que isto — protege contra um erro de janela virar um
 * disparo em massa, e contra a tela de revisão ficar impossível de usar.
 */
export const MAX_AUDIENCE_SIZE = 500;

function buildAudienceQuery(clinicId: string, segment: AudienceSegment) {
  const conditions = [
    sql`l.organization_id = ${clinicId}`,
    sql`c.category = 'sales'`,

    // ── Exclusões de segurança (incondicionais) ──────────────────────────
    // Opt-out durável: o lead pediu para não receber mais.
    sql`l.contact_consent_revoked_at IS NULL`,
    // Sem endereço, não há o que enviar.
    sql`(l.phone IS NOT NULL OR l.whatsapp_lid IS NOT NULL)`,
    // Quem já fechou não é público de recuperação.
    sql`l.status NOT IN ('won', 'appointment_scheduled')`,
    // Agendamento futuro ativo: mandar oferta de recuperação para quem acabou
    // de marcar é o constrangimento que queima a confiança na ferramenta.
    sql`NOT EXISTS (
      SELECT 1 FROM appointments a
      WHERE a.lead_id = l.id
        AND a.organization_id = ${clinicId}
        AND a.status IN ('scheduled', 'confirmed')
        AND a.starts_at > NOW()
    )`,
    // Contato proativo recente, de qualquer produtor (follow-up, recovery ou
    // outra campanha). A fonte é a outbox, não uma tabela-proxy: é o registro
    // de tudo que de fato saiu.
    sql`NOT EXISTS (
      SELECT 1 FROM outbound_messages om
      JOIN conversations oc ON oc.id = om.conversation_id
      WHERE oc.lead_id = l.id
        AND om.organization_id = ${clinicId}
        AND om.category IN ('follow_up', 'recovery', 'campaign')
        AND om.status = 'sent'
        AND om.sent_at > NOW() - make_interval(days => ${segment.excludeContactedWithinDays})
    )`,
    // Cap de vida: quantas campanhas de reativação este lead já recebeu.
    sql`(
      SELECT COUNT(*) FROM reactivation_campaign_targets rct
      WHERE rct.lead_id = l.id
        AND rct.organization_id = ${clinicId}
        AND rct.status IN ('sent', 'replied', 'converted')
    ) < ${segment.lifetimeCampaignCap}`,

    // ── Seleção (o que a clínica escolheu) ───────────────────────────────
    sql`c.last_message_at <= NOW() - make_interval(days => ${segment.windowToDaysAgo})`,
    sql`c.last_message_at >= NOW() - make_interval(days => ${segment.windowFromDaysAgo})`,
  ];

  // Filtrar por motivo implica exigir classificação: sem ela não há como saber
  // se o lead pertence ao segmento. Sem filtro de motivo, a classificação é
  // opcional e entra só como informação no preview.
  if (segment.outcomeReasons?.length) {
    conditions.push(
      sql`lo.reason::text IN (
        SELECT jsonb_array_elements_text(${JSON.stringify(segment.outcomeReasons)}::jsonb)
      )`,
    );
    if (segment.minConfidence && segment.minConfidence > 0) {
      conditions.push(sql`lo.confidence >= ${segment.minConfidence}`);
    }
  }

  // Estágio é fato calculado, não julgamento do modelo — por isso NÃO exige
  // `minConfidence`. Amarrá-lo à confiança da classificação recriaria o gargalo
  // que ele veio resolver: em produção, `price` com confiança ≥60% dava 1 lead,
  // enquanto `after_quote` dá 17.
  if (segment.silenceStages?.length) {
    conditions.push(
      sql`lo.silence_stage::text IN (
        SELECT jsonb_array_elements_text(${JSON.stringify(segment.silenceStages)}::jsonb)
      )`,
    );
  }

  if (segment.leadStatuses?.length) {
    conditions.push(
      sql`l.status::text IN (
        SELECT jsonb_array_elements_text(${JSON.stringify(segment.leadStatuses)}::jsonb)
      )`,
    );
  }

  const where = sql.join(conditions, sql` AND `);

  return sql`
    FROM leads l
    JOIN conversations c ON c.lead_id = l.id
    LEFT JOIN lead_outcomes lo
      ON lo.lead_id = l.id AND lo.organization_id = ${clinicId}
    WHERE ${where}
  `;
}

/** Erro de segmento inválido chegando até aqui é bug de chamador, não de usuário. */
function assertValidSegment(segment: AudienceSegment): void {
  const errors = validateSegment(segment);
  if (errors.length > 0) {
    throw new Error(
      `Segmento inválido: ${errors.map((e) => `${e.field} — ${e.message}`).join("; ")}`,
    );
  }
}

/**
 * Preview: quantos entram, uma amostra, e a quebra por motivo.
 * Obrigatório antes de aprovar — ninguém dispara às cegas.
 */
export async function previewAudience(
  clinicId: string,
  segment: AudienceSegment,
): Promise<AudiencePreview> {
  assertValidSegment(segment);
  const from = buildAudienceQuery(clinicId, segment);

  const [countResult, sampleResult, byReasonResult, byStageResult] = await Promise.all([
    db.execute(sql`SELECT COUNT(*)::int AS total ${from}`),
    db.execute(sql`
      SELECT
        l.id                 AS lead_id,
        c.id                 AS conversation_id,
        l.name,
        l.phone,
        l.whatsapp_lid,
        l.treatment_interest,
        l.status             AS lead_status,
        lo.reason            AS outcome_reason,
        lo.confidence        AS outcome_confidence,
        lo.silence_stage,
        lo.evidence_excerpt
      ${from}
      ORDER BY c.last_message_at DESC
      LIMIT ${PREVIEW_SAMPLE_SIZE}
    `),
    db.execute(sql`
      SELECT lo.reason AS reason, COUNT(*)::int AS count
      ${from}
      GROUP BY lo.reason
      ORDER BY COUNT(*) DESC
    `),
    // Quebra por estágio: é a leitura acionável. "82 sem resposta" não ajuda
    // ninguém a decidir; "17 viram o valor e sumiram, 18 perguntaram preço e
    // não foram respondidas" ajuda.
    db.execute(sql`
      SELECT lo.silence_stage AS stage, COUNT(*)::int AS count
      ${from}
      GROUP BY lo.silence_stage
      ORDER BY COUNT(*) DESC
    `),
  ]);

  const total = Number((countResult.rows[0] as { total: number })?.total ?? 0);

  return {
    total,
    willMaterialize: Math.min(total, MAX_AUDIENCE_SIZE),
    truncated: total > MAX_AUDIENCE_SIZE,
    sample: sampleResult.rows as AudienceLead[],
    byReason: byReasonResult.rows as Array<{ reason: string | null; count: number }>,
    byStage: byStageResult.rows as Array<{ stage: string | null; count: number }>,
  };
}

/**
 * Lista completa para materializar os alvos da campanha.
 * Limitada a MAX_AUDIENCE_SIZE — ver a constante para o porquê.
 */
export async function resolveAudience(
  clinicId: string,
  segment: AudienceSegment,
): Promise<AudienceLead[]> {
  assertValidSegment(segment);
  const from = buildAudienceQuery(clinicId, segment);

  const result = await db.execute(sql`
    SELECT
      l.id                 AS lead_id,
      c.id                 AS conversation_id,
      l.name,
      l.phone,
      l.whatsapp_lid,
      l.treatment_interest,
      l.status             AS lead_status,
      lo.reason            AS outcome_reason,
      lo.confidence        AS outcome_confidence,
      lo.evidence_excerpt,
      lo.silence_stage,
      c.last_message_at
    ${from}
    ORDER BY c.last_message_at DESC
    LIMIT ${MAX_AUDIENCE_SIZE}
  `);

  return result.rows as AudienceLead[];
}
