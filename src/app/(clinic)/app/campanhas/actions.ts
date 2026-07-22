"use server";

import { revalidatePath } from "next/cache";
import { readSession, requireSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { previewAudience } from "@/application/reactivation/audience-resolver";
import { parseSegment, type AudienceSegment } from "@/application/reactivation/audience-segment";
import {
  approveCampaign,
  createReactivationCampaign,
} from "@/application/reactivation/create-campaign";
import { generateDraftsForCampaign } from "@/application/reactivation/generate-drafts";
import {
  approveTargets,
  editTargetMessage,
  rejectTargets,
} from "@/application/reactivation/review-targets";
import { dispatchCampaign } from "@/application/reactivation/dispatch-campaign";

export type ActionState = { ok: boolean; message?: string } | null;

function parseIntOrUndefined(value: FormDataEntryValue | null): number | undefined {
  if (value === null || String(value).trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

function segmentFromForm(formData: FormData): AudienceSegment {
  const reasons = formData.getAll("outcomeReasons").map(String).filter(Boolean);
  const { segment } = parseSegment({
    windowFromDaysAgo: parseIntOrUndefined(formData.get("windowFromDaysAgo")),
    windowToDaysAgo: parseIntOrUndefined(formData.get("windowToDaysAgo")),
    minConfidence: parseIntOrUndefined(formData.get("minConfidence")),
    excludeContactedWithinDays: parseIntOrUndefined(formData.get("excludeContactedWithinDays")),
    lifetimeCampaignCap: parseIntOrUndefined(formData.get("lifetimeCampaignCap")),
    outcomeReasons: reasons.length > 0 ? reasons : undefined,
  });
  return segment;
}

/** Preview obrigatório antes de criar — quantos entram e a quebra por motivo. */
export async function previewCampaignAudience(formData: FormData) {
  const clinicId = await requireSessionClinicId();
  const segment = segmentFromForm(formData);

  try {
    const preview = await previewAudience(clinicId, segment);
    return { ok: true as const, preview };
  } catch (err: unknown) {
    return {
      ok: false as const,
      message: err instanceof Error ? err.message : "Não foi possível calcular a audiência.",
    };
  }
}

export async function createCampaignAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const clinicId = await requireSessionClinicId();
  const session = await readSession();

  const deadlineRaw = String(formData.get("deadlineAt") ?? "").trim();
  const priceCampaignId = String(formData.get("priceCampaignId") ?? "").trim() || null;

  const result = await createReactivationCampaign({
    clinicId,
    name: String(formData.get("name") ?? ""),
    segment: segmentFromForm(formData),
    priceCampaignId,
    deadlineAt: deadlineRaw ? new Date(`${deadlineRaw}T23:59:59`) : null,
    dailySendCap: parseIntOrUndefined(formData.get("dailySendCap")),
    testLeadId: String(formData.get("testLeadId") ?? "").trim() || null,
    createdByEmail: session?.email ?? null,
  });

  if (!result.ok) {
    return { ok: false, message: result.errors.map((e) => e.message).join(" ") };
  }

  revalidatePath("/app/campanhas");
  return { ok: true, message: `Campanha criada com ${result.targetCount} contatos.` };
}

export async function generateDraftsAction(campaignId: string): Promise<ActionState> {
  const clinicId = await requireSessionClinicId();
  const result = await generateDraftsForCampaign({ clinicId, campaignId });

  revalidatePath(`/app/campanhas/${campaignId}`);

  if (result.budgetExhausted) {
    return {
      ok: false,
      message: `${result.generated} mensagens escritas. O limite de custo da campanha foi atingido — rode de novo para continuar.`,
    };
  }

  const partes = [`${result.generated} mensagens escritas`];
  if (result.rejected > 0) partes.push(`${result.rejected} descartadas na validação`);
  if (result.failed > 0) partes.push(`${result.failed} falharam`);
  return { ok: result.generated > 0, message: `${partes.join(", ")}.` };
}

export async function approveTargetsAction(
  campaignId: string,
  targetIds: string[],
): Promise<ActionState> {
  const clinicId = await requireSessionClinicId();
  const result = await approveTargets({ clinicId, campaignId, targetIds });
  revalidatePath(`/app/campanhas/${campaignId}`);
  if (result.error) return { ok: false, message: result.error };
  return { ok: true, message: `${result.updated} mensagens aprovadas.` };
}

export async function rejectTargetsAction(
  campaignId: string,
  targetIds: string[],
): Promise<ActionState> {
  const clinicId = await requireSessionClinicId();
  const result = await rejectTargets({ clinicId, campaignId, targetIds });
  revalidatePath(`/app/campanhas/${campaignId}`);
  if (result.error) return { ok: false, message: result.error };
  return { ok: true, message: `${result.updated} mensagens descartadas.` };
}

export async function editTargetAction(
  campaignId: string,
  targetId: string,
  text: string,
): Promise<ActionState> {
  const clinicId = await requireSessionClinicId();
  const result = await editTargetMessage({ clinicId, campaignId, targetId, text });
  revalidatePath(`/app/campanhas/${campaignId}`);
  if (result.error) return { ok: false, message: result.error };
  return { ok: true, message: "Mensagem atualizada." };
}

export async function approveCampaignAction(campaignId: string): Promise<ActionState> {
  const clinicId = await requireSessionClinicId();
  const session = await readSession();
  if (!session) return { ok: false, message: "Sessão expirada." };

  const result = await approveCampaign({
    clinicId,
    campaignId,
    approvedByEmail: session.email,
  });

  revalidatePath(`/app/campanhas/${campaignId}`);
  if (!result.ok) return { ok: false, message: result.error };
  return { ok: true, message: `Campanha liberada com ${result.approvedTargets} mensagens.` };
}

/** Ensaio e disparo real usam o mesmo caminho — o que muda é a campanha ter `testLeadId`. */
export async function dispatchCampaignAction(campaignId: string): Promise<ActionState> {
  const clinicId = await requireSessionClinicId();
  const result = await dispatchCampaign({ clinicId, campaignId });

  revalidatePath(`/app/campanhas/${campaignId}`);

  if (result.blockedReason) {
    return { ok: false, message: `Nada foi enviado: ${result.blockedReason}.` };
  }

  const rotulo = result.rehearsal ? "ensaio" : "envio";
  const partes = [`${result.queued} mensagens na fila (${rotulo})`];
  if (result.skipped > 0) partes.push(`${result.skipped} puladas`);
  if (result.failed > 0) partes.push(`${result.failed} falharam`);
  return { ok: result.queued > 0, message: `${partes.join(", ")}.` };
}
