import { db } from "@/infrastructure/db/client";
import { professionals } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";

// Decide qual profissional cadastrado recebe os agendamentos importados que
// não mencionam nenhum profissional no texto do evento. Regra pragmática
// para o caso real (Vitalli): o dono da clínica é o profissional "padrão" —
// se houver alguém com "victor" no nome, usa esse; senão, se só existir um
// profissional ativo cadastrado, usa esse (nada para decidir); caso
// contrário (múltiplos profissionais, nenhum "victor"), não arrisca um
// palpite e retorna null — melhor sem profissional do que atribuído errado.
export async function resolveDefaultProfessionalId(clinicId: string): Promise<string | null> {
  const clinicProfessionals = await db.query.professionals.findMany({
    where: eq(professionals.clinicId, clinicId),
    columns: { id: true, name: true },
  });

  const named = clinicProfessionals.find((p) => p.name.toLowerCase().includes("victor"));
  if (named) return named.id;

  if (clinicProfessionals.length === 1) return clinicProfessionals[0].id;

  return null;
}
