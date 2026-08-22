import { and, eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { professionals } from "@/infrastructure/db/schema";

// Decide qual profissional cadastrado recebe os agendamentos importados que
// não mencionam nenhum profissional no texto do evento. Só considera
// profissionais ativos: se existir exatamente um ativo na clínica, usa esse
// (nada para decidir); caso contrário — nenhum ativo, ou vários ativos e
// ambíguo — retorna null. Um agendamento sem profissional é preferível a um
// atribuído ao profissional errado (isolamento entre tenants).

type ProfessionalForSelection = { id: string; isActive: boolean };

export function pickDefaultProfessional(candidates: ProfessionalForSelection[]): string | null {
  const active = candidates.filter((p) => p.isActive);
  if (active.length === 1) return active[0].id;
  return null;
}

export async function resolveDefaultProfessionalId(clinicId: string): Promise<string | null> {
  const clinicProfessionals = await db.query.professionals.findMany({
    where: and(eq(professionals.clinicId, clinicId), eq(professionals.isActive, true)),
    columns: { id: true, isActive: true },
  });

  return pickDefaultProfessional(clinicProfessionals);
}
