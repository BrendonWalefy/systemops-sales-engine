import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/infrastructure/db/client";
import { playbookVersions, treatments } from "@/infrastructure/db/schema";

/**
 * FONTE ÚNICA DA VERDADE EDITORIAL.
 *
 * Antes deste módulo existiam três fontes que "pareciam" a configuração da IA:
 *  - playbook_versions (versão publicada)
 *  - clinics.commercialPolicy / clinics.playbook (o que a produção lia)
 *  - treatments (procedimentos)
 *
 * A produção lia um Frankenstein de pedaços de cada uma. Resultado: o cliente
 * publicava no playbook e a produção continuava lendo o clinics antigo.
 *
 * Regra agora:
 *  - O DONO do conteúdo editorial é a versão `active` de playbook_versions.
 *  - O DONO dos procedimentos é a tabela `treatments` (estruturado, agendável).
 *  - O texto do playbook entregue à IA é COMPOSTO a partir desses campos
 *    estruturados — nunca digitado como blob livre.
 *  - clinics deixa de ser fonte de qualquer campo editorial.
 */

export type EditorialProcedure = {
  name: string;
  description: string | null;
};

export type MediaLibraryItem = {
  id: string;
  title: string;
  url: string;
  type: "video" | "image";
};

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
  procedureDescription: z
    .string()
    .trim()
    .min(1, "descrição de procedimentos não pode ser vazia"),
  toneOfVoice: z.string().trim().min(1).default("acolhedor"),
  receptionistName: z.string().trim().min(1, "nome da recepcionista é obrigatório").default("Marina"),
  differentials: z.array(z.string()).default([]),
  objections: z
    .array(z.object({ objection: z.string(), response: z.string() }))
    .default([]),
  greetingMessage: z.string().optional(),
});

/**
 * Valida o campo `notes` para garantir que não está sendo usado como depósito
 * de informações que pertencem a campos estruturados (preços → commercialPolicy,
 * objeções → objections). Retorna lista de avisos; nunca bloqueia publicação.
 */
export function lintPlaybookNotes(notes: string | null | undefined): string[] {
  if (!notes?.trim()) return [];
  const warnings: string[] = [];
  if (/R\$\s*[\d.,]+/.test(notes)) {
    warnings.push('notes contém padrão de preço (R$). Preços pertencem a commercialPolicy.');
  }
  if (/parcel[ao]|entrada|parcela/i.test(notes)) {
    warnings.push('notes menciona condições de pagamento. Isso pertence a commercialPolicy.');
  }
  if (/objeç[aã]o|desconto|caro|barato/i.test(notes)) {
    warnings.push('notes menciona objeções. Use o campo Objeções para isso.');
  }
  return warnings;
}

export type PublishablePlaybook = z.infer<typeof publishablePlaybookSchema>;

/**
 * Compõe o texto de orientação da IA a partir dos campos estruturados.
 * Determinístico: a mesma versão ativa sempre gera o mesmo texto, então
 * simulador e produção leem exatamente a mesma coisa.
 */
export function composePlaybookText(parts: {
  procedureDescription?: string | null;
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

  const procedureList = (parts.procedures ?? [])
    .map((p) => (p.description ? `• ${p.name} — ${p.description}` : `• ${p.name}`))
    .join("\n");

  if (procedureList) {
    sections.push(`PROCEDIMENTOS OFERECIDOS:\n${procedureList}`);
  } else if (parts.procedureDescription?.trim()) {
    sections.push(`PROCEDIMENTOS OFERECIDOS:\n${parts.procedureDescription.trim()}`);
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
      .select({ name: treatments.name, description: treatments.description })
      .from(treatments)
      .where(eq(treatments.clinicId, clinicId)),
  ]);

  if (!activeVersion) return null;

  const procedures: EditorialProcedure[] = clinicTreatments.map((t) => ({
    name: t.name,
    description: t.description,
  }));

  const differentials = (activeVersion.differentials as string[] | null) ?? [];
  const objections =
    (activeVersion.objections as { objection: string; response: string }[] | null) ?? [];
  const mediaLibrary =
    (activeVersion.mediaLibrary as MediaLibraryItem[] | null) ?? [];

  return {
    specialty: activeVersion.specialty,
    toneOfVoice: activeVersion.toneOfVoice,
    commercialPolicy: activeVersion.commercialPolicy,
    receptionistName: activeVersion.receptionistName,
    procedures,
    differentials,
    objections,
    mediaLibrary,
    playbookText: composePlaybookText({
      procedureDescription: activeVersion.procedureDescription,
      differentials,
      objections,
      procedures,
      notes: activeVersion.notes,
      mediaLibrary,
    }),
  };
}
