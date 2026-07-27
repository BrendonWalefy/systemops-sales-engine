import { NextRequest, NextResponse } from "next/server";
import { db } from "@/infrastructure/db/client";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { publishablePlaybookSchema, blockingCommercialPolicyIssues, blockingTreatmentDescriptionIssues } from "@/application/config/editorial-config";
import type { ProposedPlaybook } from "@/core/intelligence/PlaybookAdvisor";
import { treatments } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import { publishNewActivePlaybook } from "@/application/config/playbook-publication";

export const dynamic = "force-dynamic";

// POST /api/playbook/advisor/publish
// Body: { clinicId, proposedPlaybook }
// Desativa versão ativa atual e publica a sugerida como nova versão ativa.
// Nunca auto-publica: esta rota só é chamada após aprovação explícita do admin.
export async function POST(req: NextRequest) {
  try {
    // Esta rota REESCREVE o playbook ativo (comportamento da IA em produção).
    // Sessão obrigatória + clinicId precisa ser o da sessão.
    const sessionClinicId = await getSessionClinicId();
    if (!sessionClinicId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as {
      clinicId: string;
      proposedPlaybook: ProposedPlaybook;
    };

    if (!body.clinicId || !body.proposedPlaybook) {
      return NextResponse.json({ error: "clinicId and proposedPlaybook required" }, { status: 400 });
    }

    if (body.clinicId !== sessionClinicId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // GATE DE VALIDAÇÃO — bloqueia publicar config incompleta.
    // É isto que impede a IA de receber dado vazio em produção.
    const validation = publishablePlaybookSchema.safeParse(body.proposedPlaybook);
    if (!validation.success) {
      return NextResponse.json(
        {
          error: "playbook não passou na validação de publicação",
          issues: validation.error.issues.map((i) => ({
            field: i.path.join("."),
            message: i.message,
          })),
        },
        { status: 422 },
      );
    }
    const playbook = validation.data;

    const policyIssues = blockingCommercialPolicyIssues(playbook.commercialPolicy);
    const clinicTreatments = await db
      .select({ name: treatments.name, description: treatments.description })
      .from(treatments)
      .where(eq(treatments.clinicId, body.clinicId));
    const descriptionIssues = blockingTreatmentDescriptionIssues(clinicTreatments);
    const ownershipIssues = [...policyIssues, ...descriptionIssues];
    if (ownershipIssues.length > 0) {
      return NextResponse.json(
        { error: "playbook não passou nas regras de propriedade", issues: ownershipIssues },
        { status: 422 },
      );
    }

    await publishNewActivePlaybook({
      clinicId: body.clinicId,
      name: `Sugestão do Advisor — ${new Date().toLocaleDateString("pt-BR")}`,
      specialty: playbook.specialty,
      toneOfVoice: playbook.toneOfVoice,
      receptionistName: playbook.receptionistName,
      differentials: playbook.differentials,
      commercialPolicy: playbook.commercialPolicy,
      objections: playbook.objections,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[playbook/advisor/publish]", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
