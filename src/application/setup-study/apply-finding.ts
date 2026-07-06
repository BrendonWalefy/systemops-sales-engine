/**
 * Aplicação de findings validados à config da clínica (ADR-002 Fase 3).
 *
 * Princípio "o sistema decide, a LLM verbaliza": a LLM só produziu candidatos
 * na Fase 1; aqui a aplicação é **determinística**. Este módulo tem duas
 * partes:
 *
 *   1. `resolveFindingApplication` — função PURA e testável que converte um
 *      finding respondido num `ApplyPlan` tipado, sem tocar no banco. Respeita
 *      a allowlist e a regra "nunca inventar parse": correção em texto livre
 *      que não cabe num campo estruturado vira anotação em `playbook.notes`.
 *   2. `executeApplyPlan` — executor fino que escreve o plano no banco,
 *      **sempre escopado pelo clinicId da rota** (nunca do env).
 *
 * Regra de valor efetivo:
 *   - answer "confirmed" → aplica a mudança estruturada proposta pela IA.
 *   - answer "corrected" → o cliente reescreveu em texto livre; se o alvo é um
 *     campo de texto (tom, política) aplica direto, senão anota em notes.
 */

import { eq, and } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { treatments, playbookVersions } from "@/infrastructure/db/schema";
import type { SetupFinding } from "@/domain/entities/setup-study";

/** Plano de aplicação tipado — o que será escrito no banco. */
export type ApplyPlan =
  | { kind: "treatment.setPrice"; treatmentId: string; cents: number; summary: string }
  | {
      kind: "treatment.setBool";
      treatmentId: string;
      column: "priceQuotableInChat" | "requiresEvaluationFirst";
      value: boolean;
      summary: string;
    }
  | { kind: "treatment.appendAliases"; treatmentId: string; aliases: string[]; summary: string }
  | { kind: "playbook.setText"; column: "toneOfVoice" | "commercialPolicy"; value: string; summary: string }
  | { kind: "playbook.appendObjection"; objection: string; response: string; summary: string }
  | { kind: "playbook.appendNote"; note: string; summary: string }
  | { kind: "noop"; reason: string };

/** Alvo parseado da allowlist. */
type ParsedTarget =
  | { scope: "treatment"; treatmentId: string; field: string }
  | { scope: "playbook"; field: string }
  | null;

/** Extrai `{scope, field}` de um target da allowlist. Puro. */
export function parseTarget(target: string): ParsedTarget {
  const t = target.match(
    /^treatment:([0-9a-f-]{36})\.(priceCents|priceQuotableInChat|aliases|requiresEvaluationFirst)$/,
  );
  if (t) return { scope: "treatment", treatmentId: t[1], field: t[2] };
  if (target.startsWith("playbook.")) {
    return { scope: "playbook", field: target.slice("playbook.".length) };
  }
  return null;
}

/** Parse estrito de centavos: só dígitos puros (a IA emite centavos como número). */
function parseCents(raw: string): number | null {
  return /^\d+$/.test(raw.trim()) ? parseInt(raw.trim(), 10) : null;
}

/** Parse estrito de booleano textual. */
function parseBool(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (v === "true" || v === "sim") return true;
  if (v === "false" || v === "não" || v === "nao") return false;
  return null;
}

/** Divide uma lista textual ("a, b; c") em itens únicos não-vazios. */
function splitList(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[,;\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}

/** Formata centavos como "R$ 1.234,56" para os resumos. */
function formatCents(cents: number): string {
  return `R$ ${(cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
}

/** Anota em notes preservando a origem — destino de toda correção não mapeável. */
function noteFrom(finding: SetupFinding, extra?: string): ApplyPlan {
  const base = finding.claim.trim();
  const note = extra ? `${base} — ${extra}` : base;
  return { kind: "playbook.appendNote", note, summary: `Anotação: ${base.slice(0, 60)}` };
}

/**
 * Converte um finding respondido no plano de aplicação. PURA — sem I/O.
 * Findings sem resposta, informativos confirmados ou fora da allowlist → noop
 * (o owner ainda vê o item, mas não há escrita automática).
 */
export function resolveFindingApplication(finding: SetupFinding): ApplyPlan {
  const answer = finding.answer;
  if (!answer) return { kind: "noop", reason: "Finding sem resposta do cliente." };

  const correction = (answer.correction ?? "").trim();

  // Correção livre: o cliente reescreveu. Aplica direto só em campos de texto.
  if (answer.status === "corrected") {
    if (!correction) return { kind: "noop", reason: "Correção vazia." };
    const parsed = finding.proposedChange ? parseTarget(finding.proposedChange.target) : null;
    if (parsed?.scope === "playbook" && (parsed.field === "toneOfVoice" || parsed.field === "commercialPolicy")) {
      return {
        kind: "playbook.setText",
        column: parsed.field,
        value: correction,
        summary: `${parsed.field === "toneOfVoice" ? "Tom de voz" : "Política comercial"} atualizado pelo cliente`,
      };
    }
    // Qualquer outro alvo: texto livre não mapeável → notes (nunca inventar parse).
    return noteFrom(finding, `Correção do cliente: ${correction}`);
  }

  // answer.status === "confirmed": aplica a proposta estruturada da IA.
  const change = finding.proposedChange;
  if (!change) return { kind: "noop", reason: "Finding informativo confirmado — sem mudança a aplicar." };

  const parsed = parseTarget(change.target);
  if (!parsed) return { kind: "noop", reason: "Alvo fora da allowlist." };
  const newValue = change.newValue.trim();

  if (parsed.scope === "treatment") {
    switch (parsed.field) {
      case "priceCents": {
        const cents = parseCents(newValue);
        return cents === null
          ? noteFrom(finding, `Valor proposto (revisar): ${change.newValue}`)
          : { kind: "treatment.setPrice", treatmentId: parsed.treatmentId, cents, summary: `Preço → ${formatCents(cents)}` };
      }
      case "priceQuotableInChat":
      case "requiresEvaluationFirst": {
        const b = parseBool(newValue);
        return b === null
          ? noteFrom(finding, `Valor proposto (revisar): ${change.newValue}`)
          : {
              kind: "treatment.setBool",
              treatmentId: parsed.treatmentId,
              column: parsed.field,
              value: b,
              summary: `${parsed.field === "priceQuotableInChat" ? "Cotar preço no chat" : "Exige avaliação antes"} → ${b ? "sim" : "não"}`,
            };
      }
      case "aliases": {
        const aliases = splitList(newValue);
        return aliases.length === 0
          ? { kind: "noop", reason: "Nenhum apelido válido para adicionar." }
          : { kind: "treatment.appendAliases", treatmentId: parsed.treatmentId, aliases, summary: `Apelidos +${aliases.length}` };
      }
    }
  }

  // playbook.*
  switch (parsed.field) {
    case "toneOfVoice":
    case "commercialPolicy":
      return { kind: "playbook.setText", column: parsed.field, value: newValue, summary: `${parsed.field === "toneOfVoice" ? "Tom de voz" : "Política comercial"} atualizado` };
    case "notes":
      return { kind: "playbook.appendNote", note: newValue, summary: `Anotação: ${newValue.slice(0, 60)}` };
    case "objections[]":
      return { kind: "playbook.appendObjection", objection: finding.claim, response: newValue, summary: `Objeção adicionada` };
    default:
      return { kind: "noop", reason: "Campo de playbook não suportado." };
  }
}

/**
 * Executa um `ApplyPlan` no banco, **escopado por clinicId**. Retorna o resumo
 * legível do que foi escrito, ou null se noop. Escritas em array/nota fazem
 * read-modify-write sobre o registro da própria clínica.
 */
export async function executeApplyPlan(
  clinicId: string,
  plan: ApplyPlan,
): Promise<string | null> {
  switch (plan.kind) {
    case "noop":
      return null;

    case "treatment.setPrice": {
      const res = await db
        .update(treatments)
        .set({ priceCents: plan.cents, updatedAt: new Date() })
        .where(and(eq(treatments.id, plan.treatmentId), eq(treatments.clinicId, clinicId)))
        .returning({ id: treatments.id });
      if (res.length === 0) throw new Error("Tratamento não encontrado nesta clínica.");
      return plan.summary;
    }

    case "treatment.setBool": {
      const patch =
        plan.column === "priceQuotableInChat"
          ? { priceQuotableInChat: plan.value }
          : { requiresEvaluationFirst: plan.value };
      const res = await db
        .update(treatments)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(treatments.id, plan.treatmentId), eq(treatments.clinicId, clinicId)))
        .returning({ id: treatments.id });
      if (res.length === 0) throw new Error("Tratamento não encontrado nesta clínica.");
      return plan.summary;
    }

    case "treatment.appendAliases": {
      const current = await db.query.treatments.findFirst({
        where: and(eq(treatments.id, plan.treatmentId), eq(treatments.clinicId, clinicId)),
        columns: { aliases: true },
      });
      if (!current) throw new Error("Tratamento não encontrado nesta clínica.");
      const merged = Array.from(new Set([...(current.aliases ?? []), ...plan.aliases]));
      await db
        .update(treatments)
        .set({ aliases: merged, updatedAt: new Date() })
        .where(and(eq(treatments.id, plan.treatmentId), eq(treatments.clinicId, clinicId)));
      return plan.summary;
    }

    case "playbook.setText": {
      const patch = plan.column === "toneOfVoice" ? { toneOfVoice: plan.value } : { commercialPolicy: plan.value };
      const res = await db
        .update(playbookVersions)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(playbookVersions.clinicId, clinicId), eq(playbookVersions.status, "active")))
        .returning({ id: playbookVersions.id });
      if (res.length === 0) throw new Error("Playbook ativo não encontrado nesta clínica.");
      return plan.summary;
    }

    case "playbook.appendNote": {
      const active = await loadActivePlaybook(clinicId);
      const stamp = new Date().toLocaleDateString("pt-BR");
      const line = `[Estudo ${stamp}] ${plan.note}`;
      const next = active.notes ? `${active.notes}\n${line}` : line;
      await db
        .update(playbookVersions)
        .set({ notes: next, updatedAt: new Date() })
        .where(and(eq(playbookVersions.id, active.id), eq(playbookVersions.clinicId, clinicId)));
      return plan.summary;
    }

    case "playbook.appendObjection": {
      const active = await loadActivePlaybook(clinicId);
      const next = [...(active.objections ?? []), { objection: plan.objection, response: plan.response }];
      await db
        .update(playbookVersions)
        .set({ objections: next, updatedAt: new Date() })
        .where(and(eq(playbookVersions.id, active.id), eq(playbookVersions.clinicId, clinicId)));
      return plan.summary;
    }
  }
}

/**
 * Predicados de progresso do estudo (puros, testáveis). Extraídos das actions
 * para cobrir a transição de status por teste (revisão Fase 3).
 */

/** Todos os findings têm resposta do cliente? (gate de "concluir validação"). */
export function allFindingsAnswered(findings: SetupFinding[]): boolean {
  return findings.length > 0 && findings.every((f) => !!f.answer);
}

/**
 * Ainda há finding a aplicar? = respondido, não aplicado e cujo plano escreve
 * algo (não-noop). Quando falso, o estudo pode fechar como "applied".
 */
export function hasAppliableFindings(findings: SetupFinding[]): boolean {
  return findings.some(
    (f) => !f.applied && !!f.answer && resolveFindingApplication(f).kind !== "noop",
  );
}

/** Carrega o playbook ativo da clínica ou lança. */
async function loadActivePlaybook(clinicId: string) {
  const active = await db.query.playbookVersions.findFirst({
    where: and(eq(playbookVersions.clinicId, clinicId), eq(playbookVersions.status, "active")),
    columns: { id: true, notes: true, objections: true },
  });
  if (!active) throw new Error("Playbook ativo não encontrado nesta clínica.");
  return active;
}
