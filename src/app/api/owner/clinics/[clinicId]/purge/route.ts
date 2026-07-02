import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { verifyToken, COOKIE_NAME } from "@/lib/session";
import { db } from "@/infrastructure/db/client";
import {
  organizations,
  agentRecommendations,
  outboundMessages,
  followUps,
  slotReservations,
  appointments,
  calendarBlocks,
  clinicMembers,
  conversations,
  leads,
  professionals,
  rooms,
  treatments,
  inboundEvents,
  aiUsageCosts,
  ttsUsageCosts,
  whatsappMessageCosts,
  pushSubscriptions,
  playbookVersions,
  clinicMetrics,
} from "@/infrastructure/db/schema";
import { createLogger } from "@/infrastructure/logging/logger";

export const dynamic = "force-dynamic";

// Apaga permanentemente uma organização e todo o seu dado. Só é permitido
// para organizações já em "cancelled" (via /archive) — evita apagar uma
// clínica ativa por engano. `clinic_modules`, `clinic_operational_insights`
// e `treatment_gap_reports` têm onDelete: cascade no schema, não precisam
// de delete explícito aqui. `messages` cascade de `conversations`.
//
// Ordem respeita as FKs sem cascade: filhos com referência a leadId/
// conversationId/professionalId são apagados antes de leads/conversations/
// professionals; organizations é sempre o último delete.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ clinicId: string }> },
): Promise<NextResponse> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const session = token ? await verifyToken(token) : null;

  if (!session || session.role !== "owner") {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const { clinicId } = await params;

  const body = await request.json().catch(() => null) as { clinicName?: string } | null;
  if (!body?.clinicName) {
    return NextResponse.json({ error: "Informe o nome da clínica para confirmar." }, { status: 400 });
  }

  const [clinic] = await db
    .select({ name: organizations.name, operationalStatus: organizations.operationalStatus })
    .from(organizations)
    .where(eq(organizations.id, clinicId))
    .limit(1);

  if (!clinic) {
    return NextResponse.json({ error: "Clínica não encontrada." }, { status: 404 });
  }
  if (body.clinicName.trim() !== clinic.name.trim()) {
    return NextResponse.json({ error: "Nome da clínica não confere." }, { status: 400 });
  }
  if (clinic.operationalStatus !== "cancelled") {
    return NextResponse.json(
      { error: "Só é possível excluir organizações já arquivadas (canceladas)." },
      { status: 400 },
    );
  }

  // Sem transação: o driver neon-http (usado em produção/serverless) não suporta
  // transações multi-statement. Deletes sequenciais, ordenados para nunca violar
  // FK — se falhar no meio, a organização fica parcialmente limpa e pode rodar
  // de novo (todos os deletes abaixo são idempotentes por clinicId).
  await db.delete(agentRecommendations).where(eq(agentRecommendations.clinicId, clinicId));
  await db.delete(outboundMessages).where(eq(outboundMessages.clinicId, clinicId));
  await db.delete(followUps).where(eq(followUps.clinicId, clinicId));
  await db.delete(slotReservations).where(eq(slotReservations.clinicId, clinicId));
  await db.delete(appointments).where(eq(appointments.clinicId, clinicId));
  await db.delete(calendarBlocks).where(eq(calendarBlocks.clinicId, clinicId));
  await db.delete(clinicMembers).where(eq(clinicMembers.clinicId, clinicId));
  await db.delete(conversations).where(eq(conversations.clinicId, clinicId));
  await db.delete(leads).where(eq(leads.clinicId, clinicId));
  await db.delete(professionals).where(eq(professionals.clinicId, clinicId));
  await db.delete(rooms).where(eq(rooms.clinicId, clinicId));
  await db.delete(treatments).where(eq(treatments.clinicId, clinicId));
  await db.delete(inboundEvents).where(eq(inboundEvents.clinicId, clinicId));
  await db.delete(aiUsageCosts).where(eq(aiUsageCosts.clinicId, clinicId));
  await db.delete(ttsUsageCosts).where(eq(ttsUsageCosts.clinicId, clinicId));
  await db.delete(whatsappMessageCosts).where(eq(whatsappMessageCosts.clinicId, clinicId));
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.clinicId, clinicId));
  await db.delete(playbookVersions).where(eq(playbookVersions.clinicId, clinicId));
  await db.delete(clinicMetrics).where(eq(clinicMetrics.clinicId, clinicId));
  await db.delete(organizations).where(eq(organizations.id, clinicId));

  createLogger({ scope: "OwnerPanel", clinicId }).info("clinic.purged", { name: clinic.name });

  return NextResponse.json({ ok: true });
}
