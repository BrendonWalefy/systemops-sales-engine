import { db } from "@/infrastructure/db/client";
import { professionals } from "@/infrastructure/db/schema";
import { and, eq } from "drizzle-orm";

// Decide qual profissional cadastrado recebe os agendamentos importados que
// não mencionam nenhum profissional no texto do evento. Com exatamente um
// profissional ativo não há ambiguidade; com dois ou mais, o sistema não faz
// suposições baseadas em nome e deixa a atribuição vazia para revisão.
export function selectUnambiguousDefaultProfessionalId(
  clinicProfessionals: Array<{ id: string }>,
): string | null {
  return clinicProfessionals.length === 1 ? clinicProfessionals[0].id : null;
}

export async function resolveDefaultProfessionalId(clinicId: string): Promise<string | null> {
  const clinicProfessionals = await db.query.professionals.findMany({
    where: and(eq(professionals.clinicId, clinicId), eq(professionals.isActive, true)),
    columns: { id: true },
  });

  return selectUnambiguousDefaultProfessionalId(clinicProfessionals);
}
