import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { playbookVersions } from "@/infrastructure/db/schema";
import { publishablePlaybookSchema } from "@/application/config/editorial-config";
import type { ProposedPlaybook } from "@/core/intelligence/PlaybookAdvisor";

export const dynamic = "force-dynamic";

// POST /api/playbook/advisor/publish
// Body: { clinicId, proposedPlaybook }
// Desativa versão ativa atual e publica a sugerida como nova versão ativa.
// Nunca auto-publica: esta rota só é chamada após aprovação explícita do admin.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      clinicId: string;
      proposedPlaybook: ProposedPlaybook;
    };

    if (!body.clinicId || !body.proposedPlaybook) {
      return NextResponse.json({ error: "clinicId and proposedPlaybook required" }, { status: 400 });
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

    // Move a versão ativa ATUAL desta clínica para historical.
    // BUG CORRIGIDO: antes era `eq(...) && eq(...)` — em JS o && avalia o primeiro
    // eq como truthy e descarta-o, então o Drizzle recebia só a segunda condição.
    // Isso arquivava versões ativas sem filtrar por clínica (vazamento multi-tenant).
    await db
      .update(playbookVersions)
      .set({ status: "historical", updatedAt: new Date() })
      .where(
        and(
          eq(playbookVersions.clinicId, body.clinicId),
          eq(playbookVersions.status, "active"),
        ),
      );

    // Insere nova versão como ativa
    await db.insert(playbookVersions).values({
      clinicId: body.clinicId,
      name: `Sugestão do Advisor — ${new Date().toLocaleDateString("pt-BR")}`,
      status: "active",
      specialty: playbook.specialty,
      procedureDescription: playbook.procedureDescription,
      toneOfVoice: playbook.toneOfVoice,
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
