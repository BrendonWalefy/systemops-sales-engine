import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { playbookVersions } from "@/infrastructure/db/schema";
import type { ProposedPlaybook } from "@/core/intelligence/PlaybookAdvisor";

export const dynamic = "force-dynamic";

// POST /api/playbook/advisor/publish
// Body: { clinicId, proposedPlaybook }
// Desativa versão ativa atual e publica a sugerida como nova versão ativa.
// Nunca auto-publica: esta rota só é chamada após aprovação explícita do admin.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { clinicId: string; proposedPlaybook: ProposedPlaybook };

    if (!body.clinicId || !body.proposedPlaybook) {
      return NextResponse.json({ error: "clinicId and proposedPlaybook required" }, { status: 400 });
    }

    // Move versão ativa atual para historical
    await db
      .update(playbookVersions)
      .set({ status: "historical", updatedAt: new Date() })
      .where(eq(playbookVersions.clinicId, body.clinicId) && eq(playbookVersions.status, "active") as never);

    // Insere nova versão como ativa
    await db.insert(playbookVersions).values({
      clinicId: body.clinicId,
      name: `Sugestão do Advisor — ${new Date().toLocaleDateString("pt-BR")}`,
      status: "active",
      specialty: body.proposedPlaybook.specialty,
      procedureDescription: body.proposedPlaybook.procedureDescription,
      toneOfVoice: body.proposedPlaybook.toneOfVoice,
      differentials: body.proposedPlaybook.differentials,
      commercialPolicy: body.proposedPlaybook.commercialPolicy,
      objections: body.proposedPlaybook.objections,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[playbook/advisor/publish]", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
